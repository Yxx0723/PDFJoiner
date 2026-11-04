/**
 * Turning one image into bytes pdf-lib can embed.
 *
 * Two rules drive the design:
 *
 * 1. **No needless re-encoding.** A JPEG that already has enough pixels for its
 *    final size on the page is embedded byte-for-byte; the same goes for PNG.
 *    Rotation, downscaling or format conversion force a canvas round-trip, and
 *    only then do we touch the pixels.
 * 2. **Alpha survives.** When the source has a transparent channel the canvas
 *    stays transparent and we always emit PNG, over the page background that
 *    the engine paints first. Opaque sources become JPEG, which is what makes
 *    the "compressed" mode actually smaller.
 */

import { LIMITS } from '@/lib/constants';
import { ImagePdfError } from './errors';
import { rotateSize, type PageLayout } from './page-layout';
import {
  QUALITY_PRESETS,
  type EncodedImage,
  type ImageJob,
  type ImagePdfSettings,
  type Rotation,
} from './types';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Minimal surface shared by `HTMLCanvasElement` and `OffscreenCanvas`. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: '2d', options?: CanvasRenderingContext2DSettings): Ctx2D | null;
  convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob>;
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
}

export type CanvasFactory = (width: number, height: number) => CanvasLike;

export function createDomCanvasFactory(): CanvasFactory {
  return (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as CanvasLike;
  };
}

export function createOffscreenCanvasFactory(): CanvasFactory {
  return (width, height) => new OffscreenCanvas(width, height) as unknown as CanvasLike;
}

export interface EncodeRequest {
  source: CanvasImageSource;
  job: ImageJob;
  layout: PageLayout;
  settings: ImagePdfSettings;
  /** Skips the byte-for-byte path, used when pdf-lib rejects the original. */
  forceReencode?: boolean;
}

/** Pixel size we want for this image after rotation, never upscaling. */
export function targetPixels(
  job: Pick<ImageJob, 'width' | 'height' | 'rotation'>,
  layout: PageLayout,
  settings: ImagePdfSettings,
): { width: number; height: number; dpi: number } {
  const preset = QUALITY_PRESETS[settings.quality];
  const rotated = rotateSize(Math.max(1, job.width), Math.max(1, job.height), job.rotation);

  const wanted = Math.round((layout.imageBox.width / 72) * preset.dpi);
  let width = Math.max(1, Math.min(rotated.width, wanted));
  let height = Math.max(1, Math.round((width / rotated.width) * rotated.height));

  // Hard ceiling so a 100 MP scan cannot allocate a 4 GB canvas.
  const pixels = width * height;
  if (pixels > LIMITS.maxCanvasPixels) {
    const k = Math.sqrt(LIMITS.maxCanvasPixels / pixels);
    width = Math.max(1, Math.floor(width * k));
    height = Math.max(1, Math.floor(height * k));
  }

  return { width, height, dpi: preset.dpi };
}

/**
 * Draws `source` into the whole canvas, rotating clockwise by `rotation`.
 *
 * The canvas is already sized for the rotated result, so for 90°/270° the
 * source is drawn with its axes swapped (`H × W`) — that is what makes the
 * rotation a real pixel transform rather than a viewer hint.
 */
export function drawRotated(
  ctx: Ctx2D,
  source: CanvasImageSource,
  rotation: Rotation,
  destWidth: number,
  destHeight: number,
): void {
  ctx.save();
  switch (rotation) {
    case 90:
      ctx.translate(destWidth, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(source, 0, 0, destHeight, destWidth);
      break;
    case 180:
      ctx.translate(destWidth, destHeight);
      ctx.rotate(Math.PI);
      ctx.drawImage(source, 0, 0, destWidth, destHeight);
      break;
    case 270:
      ctx.translate(0, destHeight);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(source, 0, 0, destHeight, destWidth);
      break;
    default:
      ctx.drawImage(source, 0, 0, destWidth, destHeight);
      break;
  }
  ctx.restore();
}

async function canvasToBlob(canvas: CanvasLike, type: string, quality: number): Promise<Blob> {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality });
  }
  if (typeof canvas.toBlob === 'function') {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob?.(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas 编码失败'))),
        type,
        quality,
      );
    });
  }
  throw new ImagePdfError('encode-failed', '当前浏览器不支持把画布导出为图片。');
}

async function maybePassthrough(
  request: EncodeRequest,
  target: { width: number; height: number },
): Promise<EncodedImage | null> {
  const { job } = request;
  if (request.forceReencode) return null;
  if (job.rotation !== 0) return null;
  if (job.format !== 'jpeg' && job.format !== 'png') return null;
  if (target.width < job.width || target.height < job.height) return null;

  const bytes = new Uint8Array(await job.file.arrayBuffer());
  return {
    bytes,
    format: job.format,
    width: job.width,
    height: job.height,
    source: 'original',
  };
}

export async function encodeImage(
  request: EncodeRequest,
  factory: CanvasFactory,
): Promise<EncodedImage> {
  const { source, job, layout, settings } = request;
  const target = targetPixels(job, layout, settings);

  const passthrough = await maybePassthrough(request, target);
  if (passthrough) return passthrough;

  const format: 'jpeg' | 'png' = job.hasAlpha ? 'png' : 'jpeg';
  const quality = QUALITY_PRESETS[settings.quality].jpegQuality;

  const canvas = factory(target.width, target.height);
  let ctx: Ctx2D | null = null;
  try {
    ctx = canvas.getContext('2d', { alpha: format === 'png' });
    if (!ctx) throw new ImagePdfError('encode-failed', '无法创建 2D 画布上下文。');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (format === 'png') {
      ctx.clearRect(0, 0, target.width, target.height);
    } else {
      // Opaque output: pre-fill so anti-aliased edges blend with the page
      // background instead of turning black.
      ctx.fillStyle = settings.background;
      ctx.fillRect(0, 0, target.width, target.height);
    }

    drawRotated(ctx, source, job.rotation, target.width, target.height);

    const blob = await canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', quality);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    return { bytes, format, width: target.width, height: target.height, source: 'canvas' };
  } catch (error) {
    if (error instanceof ImagePdfError) throw error;
    throw new ImagePdfError('encode-failed', `处理「${job.name}」时编码失败。`, {
      fileName: job.name,
      cause: error,
    });
  } finally {
    // Drop the backing bitmap immediately: canvases are a classic source of
    // "the tab is using 3 GB" reports.
    canvas.width = 1;
    canvas.height = 1;
  }
}

/** True when this browser can run the encoder inside a worker. */
export function canEncodeOffscreen(): boolean {
  return (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof Worker !== 'undefined'
  );
}
