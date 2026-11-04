/**
 * Settings and data shapes for the "images → PDF" tool.
 *
 * Everything here is plain data with no DOM or pdf-lib dependency, so the same
 * definitions can be used by the React UI, the worker and the unit tests.
 */

/** Clockwise rotation applied to the image before it is placed on the page. */
export type Rotation = 0 | 90 | 180 | 270;

export type PageSizeMode = 'a4' | 'a5' | 'letter' | 'legal' | 'image' | 'custom';
export type OrientationMode = 'auto' | 'portrait' | 'landscape';
export type FitMode = 'contain' | 'cover' | 'stretch';
export type MarginMode = 'none' | 'normal' | 'wide' | 'custom';
export type QualityMode = 'high' | 'standard' | 'compressed';

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'heic' | 'avif' | 'unknown';

export interface ImagePdfSettings {
  pageSize: PageSizeMode;
  /** Only used when `pageSize === 'custom'`. */
  customWidthMm: number;
  customHeightMm: number;
  orientation: OrientationMode;
  fit: FitMode;
  margin: MarginMode;
  /** Only used when `margin === 'custom'`. */
  customMarginMm: number;
  /** CSS hex colour, e.g. `#ffffff`. */
  background: string;
  quality: QualityMode;
  /** DPI used to convert pixels into millimetres in `image` page-size mode. */
  imageDpi: number;
  /** Output file name without the `.pdf` suffix. */
  outputName: string;
}

/** One image scheduled for the output document. */
export interface ImageJob {
  id: string;
  name: string;
  /** Source bytes; transferred to the worker by reference (Blob clone). */
  file: Blob;
  format: ImageFormat;
  /** Natural pixel size, before the user rotation. */
  width: number;
  height: number;
  rotation: Rotation;
  hasAlpha: boolean;
}

/** Result of normalising one image for embedding. */
export interface EncodedImage {
  bytes: Uint8Array;
  format: 'jpeg' | 'png';
  /** Pixel size **after** rotation, i.e. what the page sees. */
  width: number;
  height: number;
  /** `original` means the source bytes were embedded untouched. */
  source: 'original' | 'canvas';
}

export interface ImagePdfProgress {
  phase: 'encoding' | 'saving' | 'verifying';
  /** Images fully processed. */
  done: number;
  total: number;
  fileName: string;
}

export interface PageSummary {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export interface BuildOutcome {
  bytes: Uint8Array;
  pageCount: number;
  verified: boolean;
  pages: PageSummary[];
}

export interface PaperPreset {
  width: number;
  height: number;
  label: string;
}

export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

export function ptToMm(pt: number): number {
  return (pt / PT_PER_INCH) * MM_PER_INCH;
}

/** Portrait-first presets, in millimetres. */
export const PAPER_PRESETS: Record<'a4' | 'a5' | 'letter' | 'legal', PaperPreset> = {
  a4: { width: 210, height: 297, label: 'A4' },
  a5: { width: 148, height: 210, label: 'A5' },
  letter: { width: 215.9, height: 279.4, label: 'Letter' },
  legal: { width: 215.9, height: 355.6, label: 'Legal' },
};

export const MARGIN_PRESETS_MM: Record<'none' | 'normal' | 'wide', number> = {
  none: 0,
  normal: 8,
  wide: 18,
};

/**
 * Per-quality target resolution and JPEG quality.
 *
 * `dpi` is the pixel density we aim for at the *final placed size*; we never
 * upscale beyond the source pixels, so small images stay as sharp as they are.
 */
export const QUALITY_PRESETS: Record<
  QualityMode,
  { dpi: number; jpegQuality: number; label: string; hint: string }
> = {
  high: {
    dpi: 300,
    jpegQuality: 0.95,
    label: '高质量',
    hint: '按 300 DPI 取像素；能直接嵌入的 JPEG/PNG 不重新编码',
  },
  standard: {
    dpi: 200,
    jpegQuality: 0.86,
    label: '标准',
    hint: '按 200 DPI 取像素，清晰度与体积的平衡点',
  },
  compressed: {
    dpi: 120,
    jpegQuality: 0.72,
    label: '压缩',
    hint: '按 120 DPI 取像素，体积最小；透明图片仍保留 PNG',
  },
};

export const DEFAULT_SETTINGS: ImagePdfSettings = {
  pageSize: 'a4',
  customWidthMm: 210,
  customHeightMm: 297,
  orientation: 'auto',
  fit: 'contain',
  margin: 'none',
  customMarginMm: 10,
  background: '#ffffff',
  quality: 'standard',
  imageDpi: 300,
  outputName: '',
};

export const BACKGROUND_SWATCHES = [
  { value: '#ffffff', label: '白色' },
  { value: '#f5f5f4', label: '浅灰' },
  { value: '#faf7f0', label: '米白' },
  { value: '#0f172a', label: '深色' },
] as const;
