/**
 * Minimal PNG writer for unit tests.
 *
 * Canvas is not available under Node, so the tests supply real PNG bytes built
 * here. pdf-lib embeds them exactly like a browser-encoded PNG would, which is
 * what makes the assembly tests meaningful.
 */

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export interface PngOptions {
  width: number;
  height: number;
  /** Base RGB colour. */
  color?: [number, number, number];
  /** Adds an alpha channel; values below 255 create real transparency. */
  alpha?: number;
  /** Draws a darker diagonal band so rotations are visible in screenshots. */
  pattern?: boolean;
}

export function makePng(options: PngOptions): Uint8Array {
  const { width, height, color = [64, 128, 220], alpha, pattern = false } = options;
  const channels = alpha === undefined ? 3 : 4;
  const colorType = channels === 3 ? 2 : 6;
  const stride = width * channels;

  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * channels;
      const inBand = pattern && Math.abs(x / width - y / height) < 0.12;
      raw[offset] = inBand ? Math.max(0, color[0] - 40) : color[0];
      raw[offset + 1] = inBand ? Math.max(0, color[1] - 40) : color[1];
      raw[offset + 2] = inBand ? Math.max(0, color[2] - 40) : color[2];
      if (channels === 4) raw[offset + 3] = alpha ?? 255;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(Buffer.from(raw)))),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    png.set(part, cursor);
    cursor += part.length;
  }
  return png;
}
