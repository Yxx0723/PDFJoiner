import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';

import { MergeCancelledError, PdfEngineError, splitPdf } from '@/features/pdf-split/engine';
import { inspectPdfBytes } from '@/features/pdf/engine';
import type { SplitProgress } from '@/features/pdf-split/engine';
import {
  imageXObjectNames,
  loadDoc,
  pageHasTextOperators,
  pageText,
  readFixture,
} from './helpers/pdf';

async function inspectOutput(bytes: Uint8Array) {
  const doc = await loadDoc(bytes);
  const pages = doc.getPages();
  return {
    doc,
    pageCount: doc.getPageCount(),
    texts: pages.map((page) => pageText(page, doc).split('\n').filter(Boolean)),
    sizes: pages.map((page) => page.getSize()),
    pageList: pages,
  };
}

describe('splitPdf — page counts and order', () => {
  it('handles a single-page document', async () => {
    const source = readFixture('single-page.pdf');
    const outcome = await splitPdf(source, [{ name: 'only.pdf', pages: [0] }]);

    expect(outcome.files).toHaveLength(1);
    const output = await inspectOutput(outcome.files[0].bytes);
    expect(output.pageCount).toBe(1);
    expect(output.texts[0].join(' ')).toContain('C-1');
  });

  it('turns a 3-page PDF into 3 single-page files', async () => {
    const source = readFixture('report-a.pdf');
    const outcome = await splitPdf(
      source,
      [0, 1, 2].map((page) => ({ name: `part-${page + 1}.pdf`, pages: [page] })),
    );

    expect(outcome.files).toHaveLength(3);
    expect(outcome.verified).toBe(true);

    for (const [index, file] of outcome.files.entries()) {
      expect(file.pageCount).toBe(1);
      const output = await inspectOutput(file.bytes);
      expect(output.pageCount).toBe(1);
      // The label proves *which* page ended up in this file.
      expect(output.texts[0].join(' ')).toContain(`A-${index + 1}`);
    }
  });

  it('keeps the ranges the user asked for and their order', async () => {
    const source = readFixture('pages-10.pdf');
    const outcome = await splitPdf(source, [
      { name: 'r1.pdf', pages: [0, 1, 2] },
      { name: 'r2.pdf', pages: [3, 4, 5, 6] },
      { name: 'r3.pdf', pages: [7, 8, 9] },
    ]);

    expect(outcome.files.map((file) => file.pageCount)).toEqual([3, 4, 3]);

    const labels = await Promise.all(
      outcome.files.map(async (file) => {
        const output = await inspectOutput(file.bytes);
        return output.texts.map((lines) => lines.find((line) => /^T-\d+$/.test(line)) ?? '');
      }),
    );

    expect(labels[0]).toEqual(['T-1', 'T-2', 'T-3']);
    expect(labels[1]).toEqual(['T-4', 'T-5', 'T-6', 'T-7']);
    expect(labels[2]).toEqual(['T-8', 'T-9', 'T-10']);
  });

  it('honours a reversed page order', async () => {
    const source = readFixture('pages-10.pdf');
    const outcome = await splitPdf(source, [{ name: 'rev.pdf', pages: [9, 0, 4] }]);

    const output = await inspectOutput(outcome.files[0].bytes);
    const labels = output.texts.map((lines) => lines.find((line) => /^T-\d+$/.test(line)) ?? '');
    expect(labels).toEqual(['T-10', 'T-1', 'T-5']);
  });

  it('repeats a page when the plan asks for it', async () => {
    const source = readFixture('report-a.pdf');
    const outcome = await splitPdf(source, [{ name: 'dup.pdf', pages: [1, 1] }]);

    const output = await inspectOutput(outcome.files[0].bytes);
    expect(output.pageCount).toBe(2);
    expect(output.texts[0].join(' ')).toContain('A-2');
    expect(output.texts[1].join(' ')).toContain('A-2');
  });
});

describe('splitPdf — page fidelity', () => {
  it('keeps the original page box, including landscape pages', async () => {
    const source = readFixture('report-b.pdf');
    const outcome = await splitPdf(source, [
      { name: 'b1.pdf', pages: [0] },
      { name: 'b2.pdf', pages: [1] },
    ]);

    const [first, second] = await Promise.all(
      outcome.files.map(async (file) => (await inspectOutput(file.bytes)).sizes[0]),
    );

    expect(first.width).toBeCloseTo(612, 2);
    expect(first.height).toBeCloseTo(792, 2);
    // Landscape stays landscape: the MediaBox travels with the page object.
    expect(second.width).toBeCloseTo(841.89, 2);
    expect(second.height).toBeCloseTo(595.28, 2);
    expect(second.width).toBeGreaterThan(second.height);
  });

  it('copies vector content instead of rasterising it', async () => {
    const source = readFixture('report-a.pdf');
    const outcome = await splitPdf(source, [{ name: 'v.pdf', pages: [0] }]);

    const output = await inspectOutput(outcome.files[0].bytes);
    expect(pageHasTextOperators(output.pageList[0], output.doc)).toBe(true);
    expect(imageXObjectNames(output.pageList[0], output.doc)).toEqual([]);
  });

  it('writes each output with its own title', async () => {
    const source = readFixture('pages-10.pdf');
    const outcome = await splitPdf(source, [
      { name: 'first.pdf', pages: [0] },
      { name: 'second.pdf', pages: [1] },
    ]);

    const titles = await Promise.all(
      outcome.files.map(async (file) => (await loadDoc(file.bytes)).getTitle()),
    );
    expect(titles).toEqual(['first', 'second']);
  });
});

describe('splitPdf — scale', () => {
  it('splits a 100-page PDF into 100 files', async () => {
    const source = readFixture('pages-100.pdf');
    const jobs = Array.from({ length: 100 }, (_, index) => ({
      name: `page-${index + 1}.pdf`,
      pages: [index],
    }));

    const outcome = await splitPdf(source, jobs);
    expect(outcome.files).toHaveLength(100);
    expect(outcome.files.every((file) => file.pageCount === 1)).toBe(true);

    // Spot-check first, middle and last against their labels.
    for (const index of [0, 49, 99]) {
      const output = await inspectOutput(outcome.files[index].bytes);
      expect(output.texts[0].join(' ')).toContain(`H-${index + 1}`);
    }
  });

  it('produces 5 files from 23 pages with chunk size 5', async () => {
    const source = readFixture('pages-100.pdf');
    const jobs = [0, 5, 10, 15, 20].map((start, index) => ({
      name: `chunk-${index + 1}.pdf`,
      pages: Array.from({ length: Math.min(5, 23 - start) }, (_, offset) => start + offset),
    }));

    const outcome = await splitPdf(source, jobs);
    expect(outcome.files.map((file) => file.pageCount)).toEqual([5, 5, 5, 5, 3]);

    const last = await inspectOutput(outcome.files[4].bytes);
    expect(last.texts.map((lines) => lines.find((line) => /^H-\d+$/.test(line)))).toEqual([
      'H-21',
      'H-22',
      'H-23',
    ]);
  });
});

describe('splitPdf — progress and cancellation', () => {
  it('reports page progress and finishes with a done stage', async () => {
    const source = readFixture('pages-10.pdf');
    const events: SplitProgress[] = [];

    await splitPdf(
      source,
      [
        { name: 'a.pdf', pages: [0, 1, 2] },
        { name: 'b.pdf', pages: [3, 4, 5, 6] },
      ],
      { onProgress: (progress) => events.push(progress) },
    );

    expect(events[0].stage).toBe('loading');
    expect(events.at(-1)?.stage).toBe('done');
    expect(events.at(-1)?.pagesDone).toBe(7);
    expect(events.every((event) => event.pagesTotal === 7)).toBe(true);
    // pagesDone never goes backwards.
    const done = events.map((event) => event.pagesDone);
    expect([...done].sort((a, b) => a - b)).toEqual(done);
    expect(events.some((event) => event.stage === 'verifying')).toBe(true);
  });

  it('stops at a file boundary when cancelled', async () => {
    const source = readFixture('pages-10.pdf');
    let cancel = false;

    const promise = splitPdf(
      source,
      [0, 1, 2].map((page) => ({ name: `p-${page}.pdf`, pages: [page] })),
      {
        shouldCancel: () => cancel,
        onProgress: (progress) => {
          // Flip the flag once the second file has been saved.
          if (progress.stage === 'saving' && progress.outputIndex === 1) cancel = true;
        },
      },
    );

    await expect(promise).rejects.toBeInstanceOf(MergeCancelledError);
  });
});

describe('splitPdf — document level structures', () => {
  it('keeps page annotations, because they hang off the page', async () => {
    const source = readFixture('outlined-annotated.pdf');
    const before = await inspectPdfBytes(source);
    expect(before.hasAnnotations).toBe(true);

    const outcome = await splitPdf(source, [{ name: 'annotated.pdf', pages: [0] }]);
    const doc = await loadDoc(outcome.files[0].bytes);

    expect(doc.getPages()[0].node.get(PDFName.of('Annots'))).toBeDefined();
    expect((await inspectPdfBytes(outcome.files[0].bytes)).hasAnnotations).toBe(true);
  });

  it('records that document outlines are dropped', async () => {
    const source = readFixture('outlined-annotated.pdf');
    expect((await inspectPdfBytes(source)).hasOutlines).toBe(true);

    const outcome = await splitPdf(source, [{ name: 'no-outline.pdf', pages: [0, 1] }]);
    const doc = await loadDoc(outcome.files[0].bytes);

    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
    expect((await inspectPdfBytes(outcome.files[0].bytes)).hasOutlines).toBe(false);
  });

  it('records that interactive form fields do not survive', async () => {
    const source = await PDFDocument.create();
    source.catalog.set(PDFName.of('AcroForm'), source.context.obj({ Fields: [] }));
    const page = source.addPage([595, 842]);
    const field = source.getForm().createTextField('customer_name');
    field.setText('Ada Lovelace');
    field.addToPage(page, { x: 40, y: 700, width: 240, height: 22 });
    const withForm = await source.save();

    expect((await inspectPdfBytes(withForm)).hasForms).toBe(true);

    const outcome = await splitPdf(withForm, [{ name: 'form.pdf', pages: [0] }]);
    const after = await inspectPdfBytes(outcome.files[0].bytes);
    expect(after.hasForms).toBe(false);
    expect(after.pageCount).toBe(1);
  });
});

describe('splitPdf — failure modes', () => {
  it('refuses encrypted PDFs instead of pretending to decrypt', async () => {
    const source = readFixture('encrypted.pdf');
    const error = await splitPdf(source, [{ name: 'x.pdf', pages: [0] }]).catch((e) => e);

    expect(error).toBeInstanceOf(PdfEngineError);
    expect(error.code).toBe('encrypted');
  });

  it('refuses a truncated PDF', async () => {
    const source = readFixture('broken.pdf');
    const error = await splitPdf(source, [{ name: 'x.pdf', pages: [0] }]).catch((e) => e);

    expect(error).toBeInstanceOf(PdfEngineError);
    expect(error.code).toBe('invalid-pdf');
  });

  it('refuses a job that references a page beyond the document', async () => {
    const source = readFixture('single-page.pdf');
    const error = await splitPdf(source, [{ name: 'x.pdf', pages: [0, 5] }]).catch((e) => e);

    expect(error.code).toBe('page-out-of-range');
    expect(error.message).toContain('第 6 页');
  });

  it('refuses an empty job list', async () => {
    const source = readFixture('report-a.pdf');
    await expect(splitPdf(source, [])).rejects.toMatchObject({ code: 'empty-plan' });
    await expect(
      splitPdf(source, [{ name: 'x.pdf', pages: [] }]),
    ).rejects.toMatchObject({ code: 'empty-plan' });
  });
});
