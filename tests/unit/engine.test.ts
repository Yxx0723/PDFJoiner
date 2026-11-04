import { describe, expect, it } from 'vitest';

import {
  MergeCancelledError,
  PdfEngineError,
  inspectPdfBytes,
  mergePdfPlans,
  type MergePlanFile,
} from '@/features/pdf/engine';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

import {
  imageXObjectNames,
  loadDoc,
  pageHasTextOperators,
  pageText,
  readFixture,
} from './helpers/pdf';

const reportA = readFixture('report-a.pdf');
const reportB = readFixture('report-b.pdf');
const outlined = readFixture('outlined-annotated.pdf');
const encrypted = readFixture('encrypted.pdf');
const broken = readFixture('broken.pdf');
const notPdf = readFixture('not-a-pdf.pdf');

function provider(map: Uint8Array[]) {
  return async (index: number) => map[index];
}

async function codeOfMerge(plans: MergePlanFile[], map: Uint8Array[]): Promise<string> {
  try {
    await mergePdfPlans(plans, { getBytes: provider(map) });
  } catch (error) {
    if (error instanceof PdfEngineError) return error.code;
    if (error instanceof MergeCancelledError) return 'cancelled';
    return 'unexpected';
  }
  return 'no-error';
}

describe('inspectPdfBytes', () => {
  it('reports page count and page boxes', async () => {
    const inspection = await inspectPdfBytes(reportA);
    expect(inspection.pageCount).toBe(3);
    expect(inspection.pageSizes).toHaveLength(3);
    expect(Math.round(inspection.pageSizes[0].width)).toBe(595);
    expect(inspection.hasOutlines).toBe(false);
    expect(inspection.hasAnnotations).toBe(false);
  });

  it('detects outlines and annotations from a real-world shaped file', async () => {
    const inspection = await inspectPdfBytes(outlined);
    expect(inspection.pageCount).toBe(3);
    expect(inspection.hasOutlines).toBe(true);
    expect(inspection.hasAnnotations).toBe(true);
  });

  it('detects mixed paper sizes', async () => {
    const inspection = await inspectPdfBytes(reportB);
    expect(inspection.pageSizes[0]).toMatchObject({ width: 612, height: 792 });
    expect(Math.round(inspection.pageSizes[1].width)).toBe(842);
    expect(Math.round(inspection.pageSizes[1].height)).toBe(595);
  });

  it('flags encrypted files instead of pretending to decrypt them', async () => {
    await expect(inspectPdfBytes(encrypted)).rejects.toSatisfy(
      (error: unknown) => error instanceof PdfEngineError && error.code === 'encrypted',
    );
  });

  it('rejects truncated and non-PDF files', async () => {
    expect(await codeOfMerge([{ name: 'broken.pdf', pages: [0] }], [broken])).toBe('invalid-pdf');
    expect(await codeOfMerge([{ name: 'x.pdf', pages: [0] }], [notPdf])).toBe('invalid-pdf');
  });

  it('detects a signature field from the AcroForm structure', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.catalog.set(
      PDFName.of('AcroForm'),
      doc.context.obj({
        SigFlags: 3,
        Fields: [
          doc.context.obj({
            Type: 'Annot',
            Subtype: 'Widget',
            FT: 'Sig',
            T: 'Signature1',
            Rect: [0, 0, 0, 0],
          }),
        ],
      }),
    );
    const bytes = await doc.save();

    const inspection = await inspectPdfBytes(bytes);
    expect(inspection.hasSignatures).toBe(true);
    expect(inspection.hasForms).toBe(true);
  });
});

describe('mergePdfPlans', () => {
  it('merges selected pages of several files in order', async () => {
    const outcome = await mergePdfPlans(
      [
        { name: 'report-a.pdf', pages: [0, 1, 2] },
        { name: 'report-b.pdf', pages: [0, 1] },
      ],
      { getBytes: provider([reportA, reportB]) },
    );

    expect(outcome.pageCount).toBe(5);
    expect(outcome.verified).toBe(true);

    const doc = await loadDoc(outcome.bytes);
    expect(doc.getPageCount()).toBe(5);

    const texts = doc.getPages().map((page) => pageText(page, doc));
    expect(texts[0]).toContain('A-1');
    expect(texts[1]).toContain('A-2');
    expect(texts[2]).toContain('A-3');
    expect(texts[3]).toContain('B-1');
    expect(texts[4]).toContain('B-2');
  });

  it('honours an explicit, non ascending page selection', async () => {
    const outcome = await mergePdfPlans([{ name: 'report-a.pdf', pages: [2, 0] }], {
      getBytes: provider([reportA]),
    });

    const doc = await loadDoc(outcome.bytes);
    const texts = doc.getPages().map((page) => pageText(page, doc));
    expect(texts[0]).toContain('A-3');
    expect(texts[1]).toContain('A-1');
  });

  it('duplicates a page when it appears twice in the range', async () => {
    const outcome = await mergePdfPlans([{ name: 'report-a.pdf', pages: [0, 0, 2] }], {
      getBytes: provider([reportA]),
    });

    const doc = await loadDoc(outcome.bytes);
    expect(doc.getPageCount()).toBe(3);
    const texts = doc.getPages().map((page) => pageText(page, doc));
    expect(texts[0]).toContain('A-1');
    expect(texts[1]).toContain('A-1');
    expect(texts[2]).toContain('A-3');
  });

  it('keeps original page sizes and orientation', async () => {
    const outcome = await mergePdfPlans(
      [
        { name: 'report-a.pdf', pages: [0] },
        { name: 'report-b.pdf', pages: [0, 1] },
      ],
      { getBytes: provider([reportA, reportB]) },
    );

    const doc = await loadDoc(outcome.bytes);
    const sizes = doc.getPages().map((page) => {
      const { width, height } = page.getSize();
      return [Math.round(width), Math.round(height)];
    });

    expect(sizes).toEqual([
      [595, 842],
      [612, 792],
      [842, 595], // landscape page stays landscape
    ]);
  });

  it('keeps vector content: text operators and fonts, no rasterised image', async () => {
    const outcome = await mergePdfPlans([{ name: 'report-a.pdf', pages: [0] }], {
      getBytes: provider([reportA]),
    });

    const doc = await loadDoc(outcome.bytes);
    const page = doc.getPages()[0];
    expect(pageHasTextOperators(page, doc)).toBe(true);
    expect(imageXObjectNames(page, doc)).toEqual([]);

    const resources = page.node.lookup(PDFName.of('Resources'));
    expect(resources).toBeInstanceOf(PDFDict);
    expect((resources as PDFDict).lookup(PDFName.of('Font'))).toBeDefined();
  });

  it('preserves page level annotations', async () => {
    const outcome = await mergePdfPlans([{ name: 'outlined-annotated.pdf', pages: [0, 1, 2] }], {
      getBytes: provider([outlined]),
    });

    const doc = await loadDoc(outcome.bytes);
    expect(doc.getPages()[0].node.get(PDFName.of('Annots'))).toBeDefined();
  });

  it('documents that document level outlines are dropped', async () => {
    const outcome = await mergePdfPlans([{ name: 'outlined-annotated.pdf', pages: [0, 1, 2] }], {
      getBytes: provider([outlined]),
    });

    const doc = await loadDoc(outcome.bytes);
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
  });

  it('documents that interactive form fields are flattened away', async () => {
    const source = await PDFDocument.create();
    source.catalog.set(PDFName.of('AcroForm'), source.context.obj({ Fields: [] }));
    const page = source.addPage([595, 842]);
    const field = source.getForm().createTextField('customer_name');
    field.setText('Ada Lovelace');
    field.addToPage(page, { x: 40, y: 700, width: 240, height: 22 });
    const withForm = await source.save();

    const before = await inspectPdfBytes(withForm);
    expect(before.hasForms).toBe(true);

    const outcome = await mergePdfPlans([{ name: 'form.pdf', pages: [0] }], {
      getBytes: provider([withForm]),
    });
    const after = await inspectPdfBytes(outcome.bytes);
    expect(after.hasForms).toBe(false);
    expect(after.pageCount).toBe(1);
  });

  it('writes PDFJoiner metadata and keeps the output title', async () => {
    const outcome = await mergePdfPlans([{ name: 'report-a.pdf', pages: [0] }], {
      getBytes: provider([reportA]),
      title: '我的合并结果',
    });

    const doc = await loadDoc(outcome.bytes);
    expect(doc.getProducer()).toContain('PDFJoiner');
    expect(doc.getTitle()).toBe('我的合并结果');
  });

  it('reports progress using real page counts', async () => {
    const events: Array<{ stage: string; pagesDone: number; pagesTotal: number }> = [];

    await mergePdfPlans(
      [
        { name: 'report-a.pdf', pages: [0, 1] },
        { name: 'report-b.pdf', pages: [0, 1] },
      ],
      {
        getBytes: provider([reportA, reportB]),
        onProgress: (progress) =>
          events.push({
            stage: progress.stage,
            pagesDone: progress.pagesDone,
            pagesTotal: progress.pagesTotal,
          }),
      },
    );

    expect(events.at(-1)).toEqual({ stage: 'done', pagesDone: 4, pagesTotal: 4 });
    expect(events.some((event) => event.stage === 'saving')).toBe(true);
    expect(events.every((event) => event.pagesDone <= event.pagesTotal)).toBe(true);
  });

  it('stops at a page boundary when cancelled', async () => {
    let seenFiles = 0;

    await expect(
      mergePdfPlans(
        [
          { name: 'a', pages: [0] },
          { name: 'b', pages: [0] },
        ],
        {
          getBytes: provider([reportA, reportB]),
          onProgress: (progress) => {
            if (progress.stage === 'copying') seenFiles = progress.fileIndex + 1;
          },
          shouldCancel: () => seenFiles >= 1,
        },
      ),
    ).rejects.toBeInstanceOf(MergeCancelledError);
  });

  it('refuses plans with out of range page indices', async () => {
    expect(await codeOfMerge([{ name: 'report-a.pdf', pages: [0, 9] }], [reportA])).toBe(
      'page-out-of-range',
    );
  });

  it('refuses empty plans', async () => {
    expect(await codeOfMerge([], [])).toBe('empty-plan');
    expect(await codeOfMerge([{ name: 'report-a.pdf', pages: [] }], [reportA])).toBe('empty-plan');
  });

  it('reports encrypted files at merge time too', async () => {
    expect(await codeOfMerge([{ name: 'encrypted.pdf', pages: [0] }], [encrypted])).toBe('encrypted');
  });
});
