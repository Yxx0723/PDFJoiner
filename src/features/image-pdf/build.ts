/**
 * Images → PDF assembly.
 *
 * The pipeline is deliberately boring: one page per image, in the order the user
 * arranged, with the geometry coming from `computePageLayout` (the same function
 * the on-screen preview uses). Heavy work is delegated through `deps.encode`, so
 * this module runs untouched in a worker, on the main thread, or in Node tests.
 */

import {
  PDFDocument,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

import { ImagePdfCancelledError, ImagePdfError } from './errors';
import { computePageLayout, type PageLayout } from './page-layout';
import type {
  BuildOutcome,
  EncodedImage,
  ImageJob,
  ImagePdfProgress,
  ImagePdfSettings,
  PageSummary,
} from './types';

export interface ImagePdfDeps {
  /**
   * Normalises one image into embeddable bytes.
   * `forceReencode` is passed when pdf-lib refused the original bytes.
   */
  encode: (
    job: ImageJob,
    layout: PageLayout,
    options: { forceReencode: boolean },
  ) => Promise<EncodedImage>;
}

export interface ImagePdfHooks {
  onProgress?: (progress: ImagePdfProgress) => void;
  /** Polled before every image; the worker flips this from a cancel message. */
  shouldCancel?: () => boolean;
}

const YIELD_EVERY = 4;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** `#RRGGBB` (or `#RGB`) → 0..1 components. Falls back to white. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = (hex || '').trim().replace(/^#/, '');
  const expand =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;

  if (!/^[0-9a-f]{6}$/i.test(expand)) return { r: 1, g: 1, b: 1 };
  return {
    r: Number.parseInt(expand.slice(0, 2), 16) / 255,
    g: Number.parseInt(expand.slice(2, 4), 16) / 255,
    b: Number.parseInt(expand.slice(4, 6), 16) / 255,
  };
}

function paintBackground(page: PDFPage, layout: PageLayout, background: string): void {
  const color = hexToRgb(background);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: layout.pageWidth,
    height: layout.pageHeight,
    color: rgb(color.r, color.g, color.b),
    borderWidth: 0,
  });
}

/**
 * Draws the image inside the page, clipped to the content box when the fit mode
 * makes it overflow.
 *
 * PDF viewers clip content to the page box, but `cover` overflow must be clipped
 * to the *margin* box, otherwise the picture would bleed into the margins. That
 * needs a real clip path, which pdf-lib exposes only through raw operators:
 * `q  x y w h re  W n  … Do  Q`.
 */
function drawPlacedImage(page: PDFPage, layout: PageLayout, image: PDFImage): void {
  if (layout.clipped) {
    page.pushOperators(
      pushGraphicsState(),
      rectangle(
        layout.contentBox.x,
        layout.contentBox.y,
        layout.contentBox.width,
        layout.contentBox.height,
      ),
      clip(),
      endPath(),
    );
  }

  page.drawImage(image, {
    x: layout.imageBox.x,
    y: layout.imageBox.y,
    width: layout.imageBox.width,
    height: layout.imageBox.height,
  });

  if (layout.clipped) page.pushOperators(popGraphicsState());
}

async function embed(doc: PDFDocument, encoded: EncodedImage): Promise<PDFImage> {
  return encoded.format === 'jpeg' ? doc.embedJpg(encoded.bytes) : doc.embedPng(encoded.bytes);
}

export async function buildImagePdf(
  jobs: ImageJob[],
  settings: ImagePdfSettings,
  deps: ImagePdfDeps,
  hooks: ImagePdfHooks = {},
): Promise<BuildOutcome> {
  if (jobs.length === 0) {
    throw new ImagePdfError('no-images', '没有可转换的图片。');
  }

  const doc = await PDFDocument.create();
  const title = (settings.outputName || '').replace(/\.pdf$/i, '').trim();
  if (title) doc.setTitle(title);
  doc.setProducer('PDFJoiner Web (pdf-lib)');
  doc.setCreator('PDFJoiner Web');
  doc.setCreationDate(new Date());

  const total = jobs.length;
  const pages: PageSummary[] = [];

  for (let index = 0; index < jobs.length; index += 1) {
    if (hooks.shouldCancel?.()) throw new ImagePdfCancelledError();

    const job = jobs[index];
    hooks.onProgress?.({ phase: 'encoding', done: index, total, fileName: job.name });

    const layout = computePageLayout({
      settings,
      imageWidth: job.width,
      imageHeight: job.height,
      rotation: job.rotation,
    });

    let encoded = await deps.encode(job, layout, { forceReencode: false });

    // pdf-lib rejects some exotic JPEG/PNG variants (CMYK, 16-bit, interlaced).
    // One transparent retry through the canvas keeps those files usable.
    let embedded: PDFImage;
    try {
      embedded = await embed(doc, encoded);
    } catch (error) {
      if (encoded.source === 'original') {
        encoded = await deps.encode(job, layout, { forceReencode: true });
        embedded = await embed(doc, encoded);
      } else {
        throw new ImagePdfError('encode-failed', `无法把「${job.name}」写入 PDF。`, {
          fileName: job.name,
          cause: error,
        });
      }
    }

    const page = doc.addPage([layout.pageWidth, layout.pageHeight]);
    paintBackground(page, layout, settings.background);
    drawPlacedImage(page, layout, embedded);

    pages.push({
      width: layout.pageWidth,
      height: layout.pageHeight,
      imageWidth: encoded.width,
      imageHeight: encoded.height,
    });

    hooks.onProgress?.({ phase: 'encoding', done: index + 1, total, fileName: job.name });

    // Give the event loop (and the worker message queue) a turn, so a cancel
    // request is actually observed mid-run instead of after the whole job.
    if (index % YIELD_EVERY === YIELD_EVERY - 1) await yieldToEventLoop();
  }

  hooks.onProgress?.({ phase: 'saving', done: total, total, fileName: '' });
  const bytes = await doc.save();

  if (hooks.shouldCancel?.()) throw new ImagePdfCancelledError();

  hooks.onProgress?.({ phase: 'verifying', done: total, total, fileName: '' });
  const verified = await verifyOutput(bytes, pages);

  return { bytes, pageCount: pages.length, verified, pages };
}

/**
 * Re-opens the produced file and checks it is a readable PDF with the expected
 * pages. A structurally broken output must surface as an error, never as a
 * success card.
 */
async function verifyOutput(bytes: Uint8Array, expected: PageSummary[]): Promise<boolean> {
  let check: PDFDocument;
  try {
    check = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    throw new ImagePdfError('verify-failed', '生成的 PDF 无法被重新读取，已中止。', {
      cause: error,
    });
  }

  if (check.getPageCount() !== expected.length) {
    throw new ImagePdfError(
      'verify-failed',
      `输出页数异常（${check.getPageCount()} ≠ ${expected.length}），已中止。`,
    );
  }

  const pages = check.getPages();
  return pages.every((page, index) => {
    const size = page.getSize();
    return (
      Math.abs(size.width - expected[index].width) < 0.5 &&
      Math.abs(size.height - expected[index].height) < 0.5
    );
  });
}
