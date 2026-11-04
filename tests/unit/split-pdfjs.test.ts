/**
 * Independent verification of split outputs with **PDF.js** — not pdf-lib.
 *
 * The acceptance list asks for every produced file to be re-opened in PDF.js to
 * check page count, order and content. Doing that here (in Node, with the same
 * pdfjs-dist build the viewer uses) is stronger than trusting the writer: a
 * file that only pdf-lib can read would fail these assertions.
 */

import { describe, expect, it } from 'vitest';

import { splitPdf } from '@/features/pdf-split/engine';
import { readFixture } from './helpers/pdf';

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let pdfjs: PdfJsModule | null = null;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

interface RenderedPage {
  width: number;
  height: number;
  text: string;
}

async function openWithPdfJs(bytes: Uint8Array): Promise<RenderedPage[]> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    isEvalSupported: false,
    // Keep the test quiet and deterministic: no worker, no font fetching.
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  try {
    const pages: RenderedPage[] = [];
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({
        width: viewport.width,
        height: viewport.height,
        text: content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' '),
      });
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

function labelsOf(pages: RenderedPage[]): string[] {
  return pages.map((page) => page.text.split(' ').find((token) => /^[TH]-\d+$/.test(token)) ?? '');
}

describe('split output — re-opened with PDF.js', () => {
  it('every range file opens, and its pages are in the requested order', async () => {
    const outcome = await splitPdf(readFixture('pages-10.pdf'), [
      { name: '1-3.pdf', pages: [0, 1, 2] },
      { name: '4-7.pdf', pages: [3, 4, 5, 6] },
      { name: '8-10.pdf', pages: [7, 8, 9] },
    ]);

    const opened = await Promise.all(
      outcome.files.map(async (file) => openWithPdfJs(file.bytes)),
    );

    expect(opened.map((pages) => pages.length)).toEqual([3, 4, 3]);
    expect(opened.map(labelsOf)).toEqual([
      ['T-1', 'T-2', 'T-3'],
      ['T-4', 'T-5', 'T-6', 'T-7'],
      ['T-8', 'T-9', 'T-10'],
    ]);

    // The page box survives the round trip through both libraries.
    for (const page of opened[0]) {
      expect(page.width).toBeCloseTo(595.28, 1);
      expect(page.height).toBeCloseTo(841.89, 1);
    }
  });

  it('an extracted file keeps a custom page order', async () => {
    const outcome = await splitPdf(readFixture('pages-10.pdf'), [
      { name: 'picked.pdf', pages: [9, 0, 4, 2] },
    ]);

    const pages = await openWithPdfJs(outcome.files[0].bytes);
    expect(pages).toHaveLength(4);
    expect(labelsOf(pages)).toEqual(['T-10', 'T-1', 'T-5', 'T-3']);
    // Each page still carries its own footer, so the content travelled intact.
    expect(pages[0].text).toContain('page 10 of 10');
    expect(pages[1].text).toContain('page 1 of 10');
  });

  it('a single-page file produced by the "each page" mode is readable', async () => {
    const outcome = await splitPdf(readFixture('pages-10.pdf'), [
      { name: 'document_page_001.pdf', pages: [0] },
      { name: 'document_page_002.pdf', pages: [1] },
    ]);

    const first = await openWithPdfJs(outcome.files[0].bytes);
    expect(first).toHaveLength(1);
    expect(first[0].text).toContain('T-1');
    expect(first[0].text).toContain('page 1 of 10');
  });

  it('a 100-page document round-trips through PDF.js without loss', async () => {
    const source = readFixture('pages-100.pdf');
    // 4 chunks of 25, matching what "按固定页数 = 25" would produce.
    const jobs = [0, 25, 50, 75].map((start) => ({
      name: `chunk-${start / 25 + 1}.pdf`,
      pages: Array.from({ length: 25 }, (_, offset) => start + offset),
    }));

    const outcome = await splitPdf(source, jobs);
    const opened = await Promise.all(
      outcome.files.map(async (file) => openWithPdfJs(file.bytes)),
    );

    expect(opened.map((pages) => pages.length)).toEqual([25, 25, 25, 25]);
    expect(labelsOf(opened[0])).toEqual(
      Array.from({ length: 25 }, (_, index) => `H-${index + 1}`),
    );
    expect(labelsOf(opened[3])[0]).toBe('H-76');
    expect(labelsOf(opened[3])[24]).toBe('H-100');
  });
});
