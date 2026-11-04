/**
 * Reading an image file's real properties before it enters the document.
 *
 * The format comes from the magic bytes (never the extension), the dimensions
 * from an actual decode — which also proves the file is not corrupt — and the
 * alpha channel from the container header. Nothing here reads the pixels twice:
 * `loadImageSource` decodes once and the bitmap is released immediately.
 */

import { LIMITS } from '@/lib/constants';
import { ImagePdfError } from './errors';
import { detectImageFormat, hasAlphaChannel } from './format';
import { loadImageSource } from './source';
import type { ImageFormat } from './types';

export interface ImageInspection {
  format: ImageFormat;
  width: number;
  height: number;
  hasAlpha: boolean;
}

const HEIF_MESSAGE =
  '当前浏览器无法解码 HEIC/HEIF 图片。Safari 可以直接解码，Chrome / Firefox / Edge 暂不支持；请先转换为 JPG 或 PNG。';

export async function inspectImageFile(file: File): Promise<ImageInspection> {
  // 64 KB is enough for the magic bytes, the PNG IHDR and palette `tRNS` chunks.
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const format = detectImageFormat(head);

  if (format === 'unknown') {
    throw new ImagePdfError(
      'unsupported',
      '无法识别该文件的图片格式。支持 JPG / PNG / WebP / BMP / GIF，Safari 另支持 HEIC。',
      { fileName: file.name },
    );
  }

  let loaded;
  try {
    loaded = await loadImageSource(file);
  } catch {
    if (format === 'heic' || format === 'avif') {
      throw new ImagePdfError('unsupported', HEIF_MESSAGE, { fileName: file.name });
    }
    throw new ImagePdfError('decode-failed', '图片已损坏或编码异常，无法解码。', {
      fileName: file.name,
    });
  }

  try {
    const { width, height } = loaded;
    if (!width || !height) {
      throw new ImagePdfError('decode-failed', '图片尺寸为 0，无法使用。', {
        fileName: file.name,
      });
    }
    if (width * height > LIMITS.maxImagePixels) {
      throw new ImagePdfError(
        'too-large',
        `图片像素过多（${width} × ${height}），超过 ${Math.round(
          LIMITS.maxImagePixels / 1_000_000,
        )} 百万像素上限。`,
        { fileName: file.name },
      );
    }

    return { format, width, height, hasAlpha: hasAlphaChannel(head, format) };
  } finally {
    loaded.release();
  }
}
