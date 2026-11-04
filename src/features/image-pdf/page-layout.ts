/**
 * Image → page layout maths.
 *
 * This is the single source of truth for "where does the image land on the
 * page". The settings panel preview and the pdf-lib engine both call
 * `computePageLayout`, so what the user sees is literally the geometry that
 * gets written into the PDF — there is no second, simplified implementation
 * for the preview.
 *
 * All values returned are PDF points (1 pt = 1/72 inch), with the origin at the
 * bottom-left corner of the page, matching PDF user space.
 */

import {
  MARGIN_PRESETS_MM,
  PAPER_PRESETS,
  mmToPt,
  ptToMm,
  type ImagePdfSettings,
  type OrientationMode,
  type Rotation,
} from './types';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutInput {
  settings: ImagePdfSettings;
  /** Natural pixel size, before rotation. */
  imageWidth: number;
  imageHeight: number;
  rotation: Rotation;
}

export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  pageWidthMm: number;
  pageHeightMm: number;
  /** Uniform margin in points. */
  margin: number;
  /** Area left after margins — the image is fitted inside this box. */
  contentBox: Box;
  /** Where the image is actually drawn; may exceed `contentBox` for `cover`. */
  imageBox: Box;
  /** Rotated aspect ratio (width / height). */
  imageAspect: number;
  /** True when the drawn image is larger than the content box and gets clipped. */
  clipped: boolean;
  orientation: 'portrait' | 'landscape';
}

/** Visible size after rotation. */
export function rotateSize(
  width: number,
  height: number,
  rotation: Rotation,
): { width: number; height: number } {
  return rotation % 180 === 0 ? { width, height } : { width: height, height: width };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Page size in millimetres, before orientation handling.
 *
 * `image` mode converts pixels to millimetres with the user selected DPI — the
 * resulting PDF page is exactly as large as the picture would be when printed
 * at that resolution.
 */
export function resolvePageSizeMm(
  settings: ImagePdfSettings,
  imageWidth: number,
  imageHeight: number,
  rotation: Rotation,
): { width: number; height: number } {
  if (settings.pageSize === 'image') {
    const rotated = rotateSize(imageWidth, imageHeight, rotation);
    const dpi = clamp(settings.imageDpi, 36, 1200);
    return {
      width: clamp((rotated.width / dpi) * 25.4, 10, 5000),
      height: clamp((rotated.height / dpi) * 25.4, 10, 5000),
    };
  }

  if (settings.pageSize === 'custom') {
    return {
      width: clamp(settings.customWidthMm, 20, 2000),
      height: clamp(settings.customHeightMm, 20, 2000),
    };
  }

  const preset = PAPER_PRESETS[settings.pageSize];
  return { width: preset.width, height: preset.height };
}

function applyOrientation(
  size: { width: number; height: number },
  imageAspect: number,
  mode: OrientationMode,
): { width: number; height: number; orientation: 'portrait' | 'landscape' } {
  const wantLandscape = mode === 'auto' ? imageAspect > 1 : mode === 'landscape';
  const isLandscape = size.width > size.height;

  if (wantLandscape === isLandscape) {
    return { ...size, orientation: isLandscape ? 'landscape' : 'portrait' };
  }

  return {
    width: size.height,
    height: size.width,
    orientation: isLandscape ? 'portrait' : 'landscape',
  };
}

function resolveMarginPt(
  settings: ImagePdfSettings,
  pageWidthMm: number,
  pageHeightMm: number,
): number {
  const mm =
    settings.margin === 'custom'
      ? clamp(settings.customMarginMm, 0, 100)
      : MARGIN_PRESETS_MM[settings.margin];

  // Never let the margins swallow the page: keep at least 4 mm of content.
  const limit = Math.max(0, Math.min(pageWidthMm, pageHeightMm) / 2 - 4);
  return mmToPt(Math.min(mm, limit));
}

export function computePageLayout(input: LayoutInput): PageLayout {
  const { settings, imageWidth, imageHeight, rotation } = input;

  const rotated = rotateSize(Math.max(1, imageWidth), Math.max(1, imageHeight), rotation);
  const imageAspect = rotated.width / rotated.height;

  const baseMm = resolvePageSizeMm(settings, imageWidth, imageHeight, rotation);
  const oriented = applyOrientation(baseMm, imageAspect, settings.orientation);

  const pageWidth = mmToPt(oriented.width);
  const pageHeight = mmToPt(oriented.height);
  const margin = resolveMarginPt(settings, oriented.width, oriented.height);

  const contentWidth = Math.max(12, pageWidth - margin * 2);
  const contentHeight = Math.max(12, pageHeight - margin * 2);
  const contentBox: Box = {
    x: (pageWidth - contentWidth) / 2,
    y: (pageHeight - contentHeight) / 2,
    width: contentWidth,
    height: contentHeight,
  };

  let drawWidth: number;
  let drawHeight: number;

  if (settings.fit === 'stretch') {
    // Intentional distortion: the user asked for the full box.
    drawWidth = contentBox.width;
    drawHeight = contentBox.height;
  } else if (settings.fit === 'contain') {
    if (contentBox.width / contentBox.height > imageAspect) {
      drawHeight = contentBox.height;
      drawWidth = drawHeight * imageAspect;
    } else {
      drawWidth = contentBox.width;
      drawHeight = drawWidth / imageAspect;
    }
  } else {
    // cover — fill the box and let the overflow be clipped away.
    if (contentBox.width / contentBox.height > imageAspect) {
      drawWidth = contentBox.width;
      drawHeight = drawWidth / imageAspect;
    } else {
      drawHeight = contentBox.height;
      drawWidth = drawHeight * imageAspect;
    }
  }

  const imageBox: Box = {
    x: contentBox.x + (contentBox.width - drawWidth) / 2,
    y: contentBox.y + (contentBox.height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };

  return {
    pageWidth,
    pageHeight,
    pageWidthMm: ptToMm(pageWidth),
    pageHeightMm: ptToMm(pageHeight),
    margin,
    contentBox,
    imageBox,
    imageAspect,
    clipped:
      settings.fit === 'cover' &&
      (drawWidth > contentBox.width + 0.01 || drawHeight > contentBox.height + 0.01),
    orientation: oriented.orientation,
  };
}

/** Short human description used under the page preview, e.g. `A4 · 210 × 297 mm`. */
export function describePage(settings: ImagePdfSettings, layout: PageLayout): string {
  const label =
    settings.pageSize === 'image'
      ? '原始尺寸'
      : settings.pageSize === 'custom'
        ? '自定义'
        : PAPER_PRESETS[settings.pageSize].label;

  return `${label} · ${layout.pageWidthMm.toFixed(0)} × ${layout.pageHeightMm.toFixed(0)} mm`;
}
