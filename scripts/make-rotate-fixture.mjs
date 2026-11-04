/**
 * Generates fixtures for the V1.3 rotation tests.
 *
 *   node scripts/make-rotate-fixture.mjs
 *
 * Kept separate from make-fixtures.mjs on purpose: re-running the original
 * generator would rewrite every existing fixture's timestamp, and the rotation
 * tool needs two new documents that none of the older suites know about.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'tests', 'fixtures');
mkdirSync(outDir, { recursive: true });

const A4 = { width: 595.28, height: 841.89 };

async function build({ file, title, specs }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(title);
  doc.setAuthor('PDFJoiner rotation fixtures');

  specs.forEach((spec, index) => {
    const page = doc.addPage([spec.width, spec.height]);
    if (spec.rotation) page.setRotation(degrees(spec.rotation));
    const { width, height } = page.getSize();

    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.95, 0.97, 1) });
    page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: rgb(0.14, 0.39, 0.92) });
    page.drawText(spec.label, { x: 48, y: height - 150, size: 40, font: bold, color: rgb(0.1, 0.13, 0.18) });
    // Vector bars prove the page is not a bitmap after rotation.
    for (let line = 0; line < 4; line += 1) {
      page.drawRectangle({ x: 48, y: height - 220 - line * 26, width: width - 96 - line * 40, height: 8, color: rgb(0.72, 0.78, 0.88) });
    }
    page.drawText(
      `page ${index + 1} of ${specs.length}  ·  native rotate ${spec.rotation} deg  ·  ${Math.round(width)} x ${Math.round(height)} pt`,
      { x: 48, y: 42, size: 9, font, color: rgb(0.35, 0.4, 0.48) },
    );
  });

  const bytes = await doc.save();
  writeFileSync(join(outDir, file), bytes);
  return { file, bytes: bytes.byteLength, pages: specs.length };
}

// Six pages: portrait, landscape, and four native /Rotate values.
const mixed = await build({
  file: 'rotate-mixed.pdf',
  title: 'Fixture G — Mixed orientations and native rotations',
  specs: [
    { ...A4, rotation: 0, label: 'ROT-1' },
    { width: A4.height, height: A4.width, rotation: 0, label: 'ROT-2' },
    { ...A4, rotation: 90, label: 'ROT-3' },
    { ...A4, rotation: 180, label: 'ROT-4' },
    { ...A4, rotation: 270, label: 'ROT-5' },
    { ...A4, rotation: 0, label: 'ROT-6' },
  ],
});

// A long document for the progressive grid and the cancellation path.
const long = await build({
  file: 'rotate-large.pdf',
  title: 'Fixture H — Six hundred pages',
  specs: Array.from({ length: 600 }, (_, index) => ({ ...A4, rotation: 0, label: `L-${index + 1}` })),
});

console.log('rotation fixtures written:');
for (const item of [mixed, long]) {
  console.log(`  ${item.file} — ${item.pages} pages, ${item.bytes} bytes`);
}
