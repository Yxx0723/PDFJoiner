/* global document -- this block runs inside the page, not in Node. */

/**
 * Generates the image fixtures used by unit and end-to-end tests.
 *
 * Chromium is used as the encoder so the files are genuine JPEG/PNG/WebP, not
 * hand-rolled approximations. BMP and GIF are written directly (BMP by hand, GIF
 * from a known-good 1×1 transparent sample) because canvas cannot produce them.
 *
 *   node scripts/make-image-fixtures.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = join(process.cwd(), 'tests', 'fixtures', 'images');
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

const jobs = [
  { file: 'photo-portrait.jpg', width: 900, height: 1350, type: 'image/jpeg', quality: 0.92, label: 'P', from: '#2563eb', to: '#0ea5e9' },
  { file: 'photo-landscape.jpg', width: 1600, height: 900, type: 'image/jpeg', quality: 0.92, label: 'L', from: '#16a34a', to: '#84cc16' },
  { file: 'graphic.png', width: 800, height: 800, type: 'image/png', label: 'A', from: '#a855f7', to: '#ec4899', alpha: true },
  { file: 'shot.webp', width: 1024, height: 640, type: 'image/webp', quality: 0.9, label: 'W', from: '#f97316', to: '#facc15' },
  { file: 'huge.jpg', width: 4000, height: 3000, type: 'image/jpeg', quality: 0.9, label: 'H', from: '#0f766e', to: '#22d3ee' },
];

for (const job of jobs) {
  const dataUrl = await page.evaluate(async (spec) => {

  function draw(ctx, w, h, label, from, to, withAlpha) {
    ctx.clearRect(0, 0, w, h);
    if (withAlpha) {
      // Rounded card on a transparent canvas: the corners stay empty.
      const r = Math.min(w, h) * 0.18;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(w, 0, w, h, r);
      ctx.arcTo(w, h, 0, h, r);
      ctx.arcTo(0, h, 0, 0, r);
      ctx.arcTo(0, 0, w, 0, r);
      ctx.closePath();
      ctx.clip();
    }

    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(2, w / 240);
    for (let i = 1; i < 8; i += 1) {
      const x = (w / 8) * i;
      const y = (h / 8) * i;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // TOP marker: red band across the top edge.
    ctx.fillStyle = '#e11d48';
    ctx.fillRect(0, 0, w, h * 0.09);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.round(h * 0.055) + 'px -apple-system, Helvetica, sans-serif';
    ctx.fillText('TOP', w / 2, h * 0.045);

    // LEFT marker: dark band down the left edge.
    ctx.fillStyle = 'rgba(15,23,42,0.82)';
    ctx.fillRect(0, h * 0.09, w * 0.09, h - h * 0.09);
    ctx.save();
    ctx.translate(w * 0.045, h * 0.56);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + Math.round(w * 0.03) + 'px -apple-system, Helvetica, sans-serif';
    ctx.fillText('LEFT', 0, 0);
    ctx.restore();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + Math.round(Math.min(w, h) * 0.16) + 'px -apple-system, Helvetica, sans-serif';
    ctx.fillText(label, w / 2, h / 2);
    ctx.font = 'bold ' + Math.round(Math.min(w, h) * 0.055) + 'px -apple-system, Helvetica, sans-serif';
    ctx.fillText(w + ' × ' + h, w / 2, h * 0.62);
  }
    const canvas = document.createElement('canvas');
    canvas.width = spec.width;
    canvas.height = spec.height;
    const ctx = canvas.getContext('2d');
    draw(ctx, spec.width, spec.height, spec.label, spec.from, spec.to, Boolean(spec.alpha));
    return canvas.toDataURL(spec.type, spec.quality);
  }, job);

  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bytes = Buffer.from(base64, 'base64');
  writeFileSync(join(OUT_DIR, job.file), bytes);
  console.log(`${job.file}  ${job.width}x${job.height}  ${(bytes.length / 1024).toFixed(0)} KB`);
}

await browser.close();

/* -------------------------------------------------------------------------- */
/* BMP: 24-bit, uncompressed, bottom-up rows                                  */
/* -------------------------------------------------------------------------- */
function makeBmp(width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const header = 54;
  const buffer = Buffer.alloc(header + pixelBytes);

  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(header, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelBytes, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y += 1) {
    const row = header + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      const topBand = y < height * 0.12;
      const leftBand = x < width * 0.12;
      const offset = row + x * 3;
      if (topBand) {
        buffer[offset] = 0x48; // B
        buffer[offset + 1] = 0x1d; // G
        buffer[offset + 2] = 0xe1; // R
      } else if (leftBand) {
        buffer[offset] = 0x2a;
        buffer[offset + 1] = 0x17;
        buffer[offset + 2] = 0x0f;
      } else {
        const shade = 40 + Math.round((x / width) * 120);
        buffer[offset] = shade + 60;
        buffer[offset + 1] = shade;
        buffer[offset + 2] = shade + 20;
      }
    }
  }
  return buffer;
}

const bmp = makeBmp(640, 480);
writeFileSync(join(OUT_DIR, 'scan.bmp'), bmp);
console.log(`scan.bmp  640×480  ${(bmp.length / 1024).toFixed(0)} KB`);

/* -------------------------------------------------------------------------- */
/* GIF: 1×1 transparent, the smallest valid sample                           */
/* -------------------------------------------------------------------------- */
const GIF_1PX = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
writeFileSync(join(OUT_DIR, 'tiny.gif'), GIF_1PX);
console.log(`tiny.gif  1×1  ${GIF_1PX.length} B`);

/* -------------------------------------------------------------------------- */
/* Damaged / not-an-image                                                    */
/* -------------------------------------------------------------------------- */
// A truncated JPEG is often still decoded by browsers (they show what they
// can), so "broken" is built from a valid SOI/APP0 header plus random bytes:
// every decoder rejects it, which is what the test needs.
const broken = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.from('PDFJoiner deliberately corrupted fixture'.repeat(40)),
]);
writeFileSync(join(OUT_DIR, 'broken.jpg'), broken);
console.log(`broken.jpg  (header + garbage, ${broken.length} B)`);

writeFileSync(join(OUT_DIR, 'not-image.png'), Buffer.from('this is definitely not a png\n'));
console.log('not-image.png  (text)');

writeFileSync(
  join(OUT_DIR, 'manifest.json'),
  `${JSON.stringify(
    {
      generatedBy: 'scripts/make-image-fixtures.mjs',
      files: [
        { name: 'photo-portrait.jpg', width: 900, height: 1350, format: 'jpeg' },
        { name: 'photo-landscape.jpg', width: 1600, height: 900, format: 'jpeg' },
        { name: 'graphic.png', width: 800, height: 800, format: 'png', alpha: true },
        { name: 'shot.webp', width: 1024, height: 640, format: 'webp' },
        { name: 'scan.bmp', width: 640, height: 480, format: 'bmp' },
        { name: 'huge.jpg', width: 4000, height: 3000, format: 'jpeg' },
        { name: 'tiny.gif', width: 1, height: 1, format: 'gif' },
        { name: 'broken.jpg', broken: true },
        { name: 'not-image.png', unsupported: true },
      ],
    },
    null,
    2,
  )}\n`,
);
console.log('manifest.json');
