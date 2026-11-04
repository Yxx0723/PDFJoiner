/**
 * Independent verification of rotated outputs with **PDF.js** — not pdf-lib.
 *
 * This proves a real reader sees the intended direction: `page.rotate` must
 * match the requested angle and the viewport must swap width/height for
 * quarter turns, while the text stream stays in the original page order.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

import { rotatePdf } from '@/features/pdf-rotate/engine';
import { buildRotationJobs } from '@/features/pdf-rotate/rotation';
import type { RotationAngle } from '@/features/pdf-rotate/types';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjs: PdfJsModule | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

interface OpenedPage {
  rotate: number;
  width: number;
  height: number;
  text: string;
}

async function openWithPdfJs(bytes: Uint8Array): Promise<OpenedPage[]> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  try {
    const opened: OpenedPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      opened.push({
        rotate: page.rotate,
        width: viewport.width,
        height: viewport.height,
        text: content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      });
    }
    return opened;
  } finally {
    await doc.destroy();
  }
}

const A4 = { width: 595.28, height: 841.89 };

async function makeSource(count = 4): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < count; index += 1) {
    const page = doc.addPage([A4.width, A4.height]);
    // Two pages already carry a native /Rotate, to prove deltas are additive.
    if (index === 2) page.setRotation(degrees(90));
    if (index === 3) page.setRotation(degrees(270));
    page.drawText(`P-${index + 1}`, { x: 48, y: 48, size: 24, font });
  }
  return doc.save();
}

describe('rotated output — re-opened with PDF.js', () => {
  it('a reader sees the exact final rotation and a swapped viewport', async () => {
    const source = await makeSource();
    const outcome = await rotatePdf(source, [
      { pageIndex: 0, finalAngle: 90 },
      { pageIndex: 1, finalAngle: 180 },
      { pageIndex: 2, finalAngle: 180 }, // was 90, so +90
      { pageIndex: 3, finalAngle: 0 }, // was 270, so +90
    ]);

    const pages = await openWithPdfJs(outcome.bytes);
    expect(pages.map((page) => page.rotate)).toEqual([90, 180, 180, 0]);

    expect(pages[0].width).toBeCloseTo(A4.height, 1);
    expect(pages[0].height).toBeCloseTo(A4.width, 1);
    expect(pages[1].width).toBeCloseTo(A4.width, 1);
    expect(pages[1].height).toBeCloseTo(A4.height, 1);
    expect(pages[2].width).toBeCloseTo(A4.width, 1);
    expect(pages[3].width).toBeCloseTo(A4.width, 1);
  });

  it('text content and page order survive a rotation', async () => {
    const source = await makeSource();
    const outcome = await rotatePdf(source, [
      { pageIndex: 0, finalAngle: 270 },
      { pageIndex: 2, finalAngle: 270 },
    ]);

    const pages = await openWithPdfJs(outcome.bytes);
    expect(pages).toHaveLength(4);
    expect(pages.map((page) => page.text)).toEqual(['P-1', 'P-2', 'P-3', 'P-4']);
  });

  it('a 100-page document keeps every angle and every label', async () => {
    const source = await makeSource(100);
    const originals: RotationAngle[] = Array.from({ length: 100 }, () => 0);
    const deltas: RotationAngle[] = Array.from({ length: 100 }, (_, index) =>
      index % 3 === 0 ? 90 : index % 3 === 1 ? 270 : 0,
    );

    const outcome = await rotatePdf(source, buildRotationJobs(originals, deltas));
    const pages = await openWithPdfJs(outcome.bytes);

    expect(pages).toHaveLength(100);
    expect(pages.map((page) => page.rotate)).toEqual(outcome.rotations);
    expect(pages[0].text).toBe('P-1');
    expect(pages[99].text).toBe('P-100');
    expect(pages[0].width).toBeCloseTo(A4.height, 1);
    expect(pages[2].width).toBeCloseTo(A4.width, 1);
  });
});
