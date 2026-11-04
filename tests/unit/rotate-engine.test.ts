/**
 * Rotation engine tests (P1).
 *
 * Everything here runs on real PDF bytes with pdf-lib — no mocked PDF writer.
 * The assertions are byte/structure level: `/Rotate`, MediaBox, content
 * streams, page order and the source buffer itself.
 */

import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees } from 'pdf-lib';

import {
  MergeCancelledError,
  PdfEngineError,
  inspectForRotation,
  rotatePdf,
} from '@/features/pdf-rotate/engine';
import { buildRotationJobs } from '@/features/pdf-rotate/rotation';
import type { RotationAngle, RotationJob, RotateProgress } from '@/features/pdf-rotate/types';
import { loadDoc, pageHasTextOperators, pageText, readFixture } from './helpers/pdf';

interface Spec {
  width: number;
  height: number;
  rotation: RotationAngle;
  label: string;
}

const MIXED: Spec[] = [
  { width: 595.28, height: 841.89, rotation: 0, label: 'R-1' }, // portrait
  { width: 841.89, height: 595.28, rotation: 0, label: 'R-2' }, // landscape box
  { width: 595.28, height: 841.89, rotation: 90, label: 'R-3' }, // pre-rotated
  { width: 595.28, height: 841.89, rotation: 270, label: 'R-4' }, // pre-rotated
];

async function makeSource(specs: Spec[] = MIXED): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Rotation fixture');
  for (const spec of specs) {
    const page = doc.addPage([spec.width, spec.height]);
    page.setRotation(degrees(spec.rotation));
    page.drawText(spec.label, { x: 40, y: 40, size: 22, font });
    page.drawRectangle({ x: 40, y: 70, width: 90, height: 12 });
  }
  return doc.save();
}

async function labelsOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await loadDoc(bytes);
  return doc.getPages().map((page) => pageText(page, doc).trim());
}

async function rotationsOf(bytes: Uint8Array): Promise<number[]> {
  const doc = await loadDoc(bytes);
  return doc.getPages().map((page) => page.getRotation().angle);
}

async function sizesOf(bytes: Uint8Array) {
  const doc = await loadDoc(bytes);
  return doc.getPages().map((page) => page.getSize());
}

describe('inspectForRotation', () => {
  it('reads every page /Rotate, including pages beyond the 60-page sample', async () => {
    const many = await makeSource(
      Array.from({ length: 80 }, (_, index) => ({
        width: 595.28,
        height: 841.89,
        rotation: (index === 79 ? 270 : 0) as RotationAngle,
        label: `M-${index + 1}`,
      })),
    );
    const result = await inspectForRotation(many);

    expect(result.pageCount).toBe(80);
    expect(result.rotations).toHaveLength(80);
    expect(result.rotations[79]).toBe(270);
    expect(result.inspection.pageCount).toBe(80);
    expect(result.inspection.pageSizes).toHaveLength(60); // shared inspector still samples
  });

  it('reports the original rotations of a mixed-orientation document', async () => {
    const result = await inspectForRotation(await makeSource());
    expect(result.rotations).toEqual([0, 0, 90, 270]);
  });

  it('refuses a source page with a non-quarter-turn /Rotate', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    page.node.set(PDFName.of('Rotate'), PDFNumber.of(45));
    const bytes = await doc.save();

    await expect(inspectForRotation(bytes)).rejects.toMatchObject({ code: 'invalid-pdf' });
  });
});

describe('rotatePdf — real PDF output', () => {
  it('rotates a single page and leaves the source bytes untouched', async () => {
    const source = readFixture('single-page.pdf');
    const before = source.slice();

    const outcome = await rotatePdf(source, [{ pageIndex: 0, finalAngle: 90 }]);

    expect(await rotationsOf(outcome.bytes)).toEqual([90]);
    expect(outcome.pageCount).toBe(1);
    expect(outcome.rotations).toEqual([90]);
    expect(outcome.verified).toBe(true);
    expect(source).toEqual(before);
  });

  it('writes final absolute angles over a document with pre-rotated pages', async () => {
    const source = await makeSource();
    // Delta per page: +90, +180, +90 (90→180), +270 (270→180).
    const deltas: RotationAngle[] = [90, 180, 90, 270];
    const jobs = buildRotationJobs([0, 0, 90, 270], deltas);

    const outcome = await rotatePdf(source, jobs);

    expect(outcome.rotations).toEqual([90, 180, 180, 180]);
    expect(await rotationsOf(outcome.bytes)).toEqual([90, 180, 180, 180]);
    // A naive "set to the delta" implementation would produce 90 here.
    expect(outcome.rotations[2]).not.toBe(90);
  });

  it('keeps page count, page order, text, vector operators and MediaBox', async () => {
    const source = await makeSource();
    const sourceSizes = await sizesOf(source);
    const outcome = await rotatePdf(source, [
      { pageIndex: 0, finalAngle: 270 },
      { pageIndex: 1, finalAngle: 90 },
      { pageIndex: 3, finalAngle: 0 },
    ]);

    const doc = await loadDoc(outcome.bytes);
    expect(doc.getPageCount()).toBe(4);
    expect(await labelsOf(outcome.bytes)).toEqual(['R-1', 'R-2', 'R-3', 'R-4']);
    await expect(sizesOf(outcome.bytes)).resolves.toEqual(sourceSizes);
    for (const page of doc.getPages()) expect(pageHasTextOperators(page, doc)).toBe(true);
  });

  it('re-opens the produced file with pdf-lib and reports verified', async () => {
    const outcome = await rotatePdf(await makeSource(), [
      { pageIndex: 2, finalAngle: 0 },
      { pageIndex: 0, finalAngle: 180 },
    ]);
    const doc = await loadDoc(outcome.bytes);
    expect(doc.getPageCount()).toBe(outcome.pageCount);
    expect(doc.getTitle()).toBe('Rotation fixture');
    expect(outcome.verified).toBe(true);
  });

  it('exports an unchanged document when no page was rotated', async () => {
    const source = await makeSource();
    const outcome = await rotatePdf(source, buildRotationJobs([0, 0, 90, 270], [0, 0, 0, 0]));
    expect(outcome.rotations).toEqual([0, 0, 90, 270]);
    expect(await rotationsOf(outcome.bytes)).toEqual([0, 0, 90, 270]);
  });

  it('preserves outlines and annotations (measured, not assumed)', async () => {
    const source = readFixture('outlined-annotated.pdf');
    const outcome = await rotatePdf(source, [{ pageIndex: 0, finalAngle: 90 }]);

    const doc = await loadDoc(outcome.bytes);
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeDefined();
    const annots = doc.getPages()[0].node.get(PDFName.of('Annots'));
    expect(annots).toBeDefined();
    expect(await rotationsOf(outcome.bytes)).toHaveLength(3);
  });
});

describe('rotatePdf — failures, cancellation and progress', () => {
  it('rejects an encrypted PDF without pretending to decrypt it', async () => {
    await expect(
      rotatePdf(readFixture('encrypted.pdf'), [{ pageIndex: 0, finalAngle: 90 }]),
    ).rejects.toMatchObject({ code: 'encrypted' });
  });

  it('rejects a truncated PDF', async () => {
    await expect(
      rotatePdf(readFixture('broken.pdf'), [{ pageIndex: 0, finalAngle: 90 }]),
    ).rejects.toMatchObject({ code: 'invalid-pdf' });
  });

  it('rejects a document with zero pages', async () => {
    const empty = await PDFDocument.create();
    const bytes = await empty.save({ addDefaultPage: false });
    await expect(
      rotatePdf(bytes, [{ pageIndex: 0, finalAngle: 90 }]),
    ).rejects.toMatchObject({ code: 'empty-document' });
  });

  it('rejects an out-of-range page index before writing anything', async () => {
    await expect(
      rotatePdf(await makeSource(), [{ pageIndex: 4, finalAngle: 90 }]),
    ).rejects.toMatchObject({ code: 'page-out-of-range' });
    await expect(
      rotatePdf(await makeSource(), [{ pageIndex: -1, finalAngle: 90 }]),
    ).rejects.toMatchObject({ code: 'page-out-of-range' });
  });

  it('rejects an illegal destination angle', async () => {
    const bad = [{ pageIndex: 0, finalAngle: 45 }] as unknown as RotationJob[];
    await expect(rotatePdf(await makeSource(), bad)).rejects.toMatchObject({ code: 'invalid-pdf' });
  });

  it('emits real staged progress with monotonically increasing page counts', async () => {
    const progress: RotateProgress[] = [];
    await rotatePdf(await makeSource(), [{ pageIndex: 1, finalAngle: 90 }], {
      onProgress: (event) => progress.push(event),
    });

    const stages = [...new Set(progress.map((event) => event.stage))];
    expect(stages).toEqual(['loading', 'applying', 'saving', 'verifying', 'done']);
    const applying = progress.filter((event) => event.stage === 'applying');
    expect(applying.at(-1)?.current).toBe(4);
    expect(applying.every((event) => event.total === 4)).toBe(true);
    for (let index = 1; index < applying.length; index += 1) {
      expect(applying[index].current).toBeGreaterThanOrEqual(applying[index - 1].current);
    }
  });

  it('stops at a cancellation checkpoint and returns no file', async () => {
    let checks = 0;
    await expect(
      rotatePdf(await makeSource(), [{ pageIndex: 0, finalAngle: 90 }], {
        shouldCancel: () => ++checks > 1,
      }),
    ).rejects.toBeInstanceOf(MergeCancelledError);
  });

  it('honestly reports an unverified output when the re-parse budget is exceeded', async () => {
    const outcome = await rotatePdf(await makeSource(), [{ pageIndex: 0, finalAngle: 90 }], {
      verifyBelowBytes: 1,
    });
    expect(outcome.verified).toBe(false);
    expect(await rotationsOf(outcome.bytes)).toEqual([90, 0, 90, 270]);
  });

  it('never exposes a PdfEngineError with an unknown code for a known failure', async () => {
    const error = await rotatePdf(readFixture('encrypted.pdf'), []).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PdfEngineError);
    expect((error as PdfEngineError).code).toBe('encrypted');
  });
});
