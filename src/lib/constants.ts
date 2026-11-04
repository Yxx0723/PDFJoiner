/**
 * Tunable limits for the browser-side pipeline. Kept in one place so that the
 * UI copy, the guards and the tests can all reference the same numbers.
 */
export const LIMITS = {
  /** Files above this size are rejected before we ever read them into memory. */
  maxFileSizeBytes: 200 * 1024 * 1024,
  /** Upper bound for the number of documents in one merge task. */
  maxFiles: 60,
  /** Thumbnail cache entries kept in memory (LRU). */
  thumbnailCacheSize: 180,
  /** Concurrent PDF.js render operations. */
  thumbnailConcurrency: 2,
  /** CSS width of a thumbnail in the page strip. */
  thumbnailWidth: 104,
  /** Larger preview width inside the zoom dialog. */
  previewWidth: 720,
  /** Re-parse the produced file to verify it, but only below this size. */
  verifyOutputBelowBytes: 64 * 1024 * 1024,

  /* ---- images → PDF ---- */
  /** Upper bound for the number of images in one task. */
  maxImageCount: 100,
  /** Per-image file size ceiling. */
  maxImageFileSizeBytes: 60 * 1024 * 1024,
  /** Decoded pixel ceiling; larger files are refused before decoding. */
  maxImagePixels: 120_000_000,
  /** Canvas allocation ceiling for a single re-encode. */
  maxCanvasPixels: 32_000_000,
  /** CSS width used by the generated-PDF preview dialog. */
  generatedPreviewWidth: 560,
} as const;

export const THEME_STORAGE_KEY = 'pdfjoiner-theme';
