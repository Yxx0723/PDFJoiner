/**
 * Generates deterministic PDF fixtures for the unit and e2e suites.
 *
 *   node scripts/make-fixtures.mjs
 *
 * Everything is produced locally with pdf-lib; no sample files are downloaded.
 * `tests/fixtures/manifest.json` records the ground truth (page counts, page
 * boxes) that the tests assert against.
 */

import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'tests', 'fixtures');
mkdirSync(outDir, { recursive: true });

const A4 = { width: 595.28, height: 841.89 };
const LETTER = { width: 612, height: 792 };

const PALETTE = [
  { bg: rgb(0.93, 0.96, 1), accent: rgb(0.14, 0.39, 0.92) },
  { bg: rgb(0.94, 1, 0.96), accent: rgb(0.05, 0.55, 0.35) },
  { bg: rgb(1, 0.96, 0.93), accent: rgb(0.85, 0.38, 0.1) },
];

async function makeDocument({ file, title, pages }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(title);
  doc.setAuthor('PDFJoiner fixtures');

  pages.forEach((spec, index) => {
    const page = doc.addPage([spec.width, spec.height]);
    const { width, height } = page.getSize();
    const palette = PALETTE[index % PALETTE.length];

    page.drawRectangle({ x: 0, y: 0, width, height, color: palette.bg });
    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: palette.accent });

    page.drawText(title, {
      x: 48,
      y: height - 78,
      size: 11,
      font: bold,
      color: palette.accent,
    });

    page.drawText(`${spec.label}`, {
      x: 48,
      y: height - 150,
      size: 42,
      font: bold,
      color: rgb(0.1, 0.13, 0.18),
    });

    // Vector rules, so the merged output can be proven non-rasterised.
    for (let line = 0; line < 6; line += 1) {
      page.drawRectangle({
        x: 48,
        y: height - 210 - line * 26,
        width: Math.max(120, width - 96 - line * 38),
        height: 7,
        color: rgb(0.72, 0.76, 0.82),
      });
    }

    page.drawText(`page ${index + 1} of ${pages.length}  ·  ${Math.round(width)} x ${Math.round(height)} pt`, {
      x: 48,
      y: 42,
      size: 9,
      font,
      color: rgb(0.35, 0.4, 0.48),
    });
  });

  const bytes = await doc.save();
  writeFileSync(join(outDir, file), bytes);
  return { file, pageCount: pages.length, pages: pages.map((p) => ({ width: p.width, height: p.height })) };
}

const manifest = { generatedAt: new Date().toISOString(), files: [] };

// 1. Three identical A4 pages.
manifest.files.push(
  await makeDocument({
    file: 'report-a.pdf',
    title: 'Fixture A — Quarterly report',
    pages: Array.from({ length: 3 }, (_, index) => ({
      ...A4,
      label: `A-${index + 1}`,
    })),
  }),
);

// 2. Two pages with different paper sizes, plus one landscape page.
manifest.files.push(
  await makeDocument({
    file: 'report-b.pdf',
    title: 'Fixture B — Mixed paper sizes',
    pages: [
      { ...LETTER, label: 'B-1' },
      { width: A4.height, height: A4.width, label: 'B-2' },
    ],
  }),
);

// 3. A single page, handy for "one page" edge cases in the range parser.
manifest.files.push(
  await makeDocument({
    file: 'single-page.pdf',
    title: 'Fixture C — Single page',
    pages: [{ ...A4, label: 'C-1' }],
  }),
);

// 4. A 300 page document, used to exercise the progress UI and to prove the
//    worker pipeline copes with a document that is not trivially small.
manifest.files.push(
  await makeDocument({
    file: 'large-300.pdf',
    title: 'Fixture D — 300 pages',
    pages: Array.from({ length: 300 }, (_, index) => ({ ...A4, label: `D-${index + 1}` })),
  }),
);

// 5. Broken: a valid PDF truncated halfway through.
const source = await PDFDocument.load(
  (await import('node:fs')).readFileSync(join(outDir, 'report-a.pdf')),
);
const intact = await source.save();
writeFileSync(join(outDir, 'broken.pdf'), intact.subarray(0, Math.floor(intact.length * 0.55)));
manifest.files.push({ file: 'broken.pdf', pageCount: null, note: 'truncated, must be rejected' });

// 6. Not a PDF at all, but with a .pdf extension.
writeFileSync(join(outDir, 'not-a-pdf.pdf'), 'This is a plain text file wearing a PDF costume.\n');
manifest.files.push({ file: 'not-a-pdf.pdf', pageCount: null, note: 'text content, must be rejected' });

// 7. Duplicate of report-a.pdf under a different name — used for the
//    "identical bytes, different name" case.
copyFileSync(join(outDir, 'report-a.pdf'), join(outDir, 'report-a-copy.pdf'));
manifest.files.push({ file: 'report-a-copy.pdf', pageCount: 3, note: 'same bytes as report-a.pdf' });

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(
  `fixtures written to ${outDir}\n` +
    manifest.files.map((f) => `  ${f.file}${f.pageCount ? ` (${f.pageCount}p)` : ''}${f.note ? ` — ${f.note}` : ''}`).join('\n'),
);
