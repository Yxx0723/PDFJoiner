/**
 * Image container sniffing.
 *
 * We trust the bytes, not the file extension: a `.pdf` renamed to `.jpg` must be
 * rejected with a clear message instead of being fed to the decoder. The result
 * only decides *how* we talk about the file — actual support is decided by the
 * browser decoder, which is the only reliable authority for WebP/BMP/GIF/HEIC.
 */

import type { ImageFormat } from './types';

const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = '';
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length < 12) return 'unknown';

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }

  // GIF87a / GIF89a
  if (ascii(bytes, 0, 4) === 'GIF8') return 'gif';

  // BMP: 'BM'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';

  // RIFF....WEBP
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';

  // ISO base media: ....ftyp<major brand>
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (AVIF_BRANDS.has(brand)) return 'avif';
    if (HEIF_BRANDS.has(brand)) return 'heic';

    // Some encoders put the interesting brand in the compatible-brands list.
    const window = ascii(bytes, 8, 32).toLowerCase();
    for (const candidate of [...AVIF_BRANDS, ...HEIF_BRANDS]) {
      if (window.includes(candidate)) return AVIF_BRANDS.has(candidate) ? 'avif' : 'heic';
    }
  }

  return 'unknown';
}

export const FORMAT_LABELS: Record<ImageFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  webp: 'WebP',
  gif: 'GIF',
  bmp: 'BMP',
  heic: 'HEIC',
  avif: 'AVIF',
  unknown: '未知格式',
};

/** Formats whose alpha channel must be preserved in the PDF. */
export function mayHaveAlpha(format: ImageFormat): boolean {
  return format === 'png' || format === 'webp' || format === 'gif' || format === 'avif';
}

function findAscii(bytes: Uint8Array, needle: string, limit: number): boolean {
  const limitIndex = Math.min(bytes.length, limit);
  outer: for (let i = 0; i + needle.length <= limitIndex; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Does this file actually carry an alpha channel?
 *
 * PNG is read precisely from the IHDR colour type (4 = grey+alpha, 6 = RGBA)
 * plus the optional `tRNS` chunk for palette images. WebP checks the VP8X alpha
 * flag. GIF and AVIF are treated as "may be transparent", which is the safe
 * direction: the worst case is a PNG where a JPEG would have been smaller,
 * never a lost transparency.
 */
export function hasAlphaChannel(bytes: Uint8Array, format: ImageFormat): boolean {
  if (format === 'jpeg' || format === 'bmp' || format === 'unknown') return false;
  if (format === 'gif' || format === 'avif') return true;

  if (format === 'png') {
    const colorType = bytes[25];
    if (colorType === 4 || colorType === 6) return true;
    return findAscii(bytes, 'tRNS', 64 * 1024);
  }

  // WebP: if the extended header (VP8X) is present its flags byte carries the
  // alpha bit (0x10). Simple lossy files have no alpha.
  if (format === 'webp') {
    if (ascii(bytes, 12, 4) === 'VP8X') {
      return (bytes[20] & 0x10) !== 0;
    }
    return findAscii(bytes, 'ALPH', 64);
  }

  return false;
}

export function isSupportedFormat(format: ImageFormat): boolean {
  return format !== 'unknown';
}
