import { describe, expect, it } from 'vitest';

import { computePageLayout, describePage, rotateSize } from '@/features/image-pdf/page-layout';
import { DEFAULT_SETTINGS, mmToPt, type ImagePdfSettings } from '@/features/image-pdf/types';

const A4 = { width: mmToPt(210), height: mmToPt(297) };

function layout(
  patch: Partial<ImagePdfSettings>,
  image: { width: number; height: number },
  rotation: 0 | 90 | 180 | 270 = 0,
) {
  return computePageLayout({
    settings: { ...DEFAULT_SETTINGS, ...patch },
    imageWidth: image.width,
    imageHeight: image.height,
    rotation,
  });
}

describe('rotateSize', () => {
  it('swaps the axes only for quarter turns', () => {
    expect(rotateSize(1200, 800, 0)).toEqual({ width: 1200, height: 800 });
    expect(rotateSize(1200, 800, 90)).toEqual({ width: 800, height: 1200 });
    expect(rotateSize(1200, 800, 180)).toEqual({ width: 1200, height: 800 });
    expect(rotateSize(1200, 800, 270)).toEqual({ width: 800, height: 1200 });
  });
});

describe('page size', () => {
  it('uses A4 by default, in points', () => {
    const result = layout({}, { width: 800, height: 1200 });
    expect(result.pageWidth).toBeCloseTo(A4.width, 2);
    expect(result.pageHeight).toBeCloseTo(A4.height, 2);
    expect(result.pageWidthMm).toBeCloseTo(210, 1);
  });

  it('supports A5, Letter and Legal', () => {
    expect(layout({ pageSize: 'a5' }, { width: 800, height: 1200 }).pageWidthMm).toBeCloseTo(
      148,
      1,
    );
    const letter = layout({ pageSize: 'letter' }, { width: 800, height: 1200 });
    expect(letter.pageWidthMm).toBeCloseTo(215.9, 1);
    expect(letter.pageHeightMm).toBeCloseTo(279.4, 1);
    const legal = layout({ pageSize: 'legal' }, { width: 800, height: 1200 });
    expect(legal.pageHeightMm).toBeCloseTo(355.6, 1);
  });

  it('converts pixels to millimetres for "original size" at 300 DPI', () => {
    const result = layout({ pageSize: 'image' }, { width: 1200, height: 800 });
    expect(result.pageWidthMm).toBeCloseTo(101.6, 1); // 4 inch
    expect(result.pageHeightMm).toBeCloseTo(67.73, 1); // 2.667 inch
    expect(result.orientation).toBe('landscape');
  });

  it('honours a custom DPI for "original size"', () => {
    const result = layout({ pageSize: 'image', imageDpi: 150 }, { width: 1200, height: 800 });
    expect(result.pageWidthMm).toBeCloseTo(203.2, 1);
  });

  it('honours a custom page size in millimetres', () => {
    const result = layout(
      { pageSize: 'custom', customWidthMm: 100, customHeightMm: 150 },
      { width: 800, height: 1200 },
    );
    expect(result.pageWidthMm).toBeCloseTo(100, 1);
    expect(result.pageHeightMm).toBeCloseTo(150, 1);
  });
});

describe('orientation', () => {
  it('auto turns the page for a landscape image', () => {
    const result = layout({ orientation: 'auto' }, { width: 1600, height: 900 });
    expect(result.pageWidth).toBeGreaterThan(result.pageHeight);
    expect(result.orientation).toBe('landscape');
  });

  it('auto keeps portrait for a portrait image', () => {
    const result = layout({ orientation: 'auto' }, { width: 800, height: 1200 });
    expect(result.pageHeight).toBeGreaterThan(result.pageWidth);
  });

  it('respects a forced portrait page for a landscape image', () => {
    const result = layout({ orientation: 'portrait' }, { width: 1600, height: 900 });
    expect(result.pageWidth).toBeCloseTo(A4.width, 2);
    expect(result.pageHeight).toBeCloseTo(A4.height, 2);
  });

  it('respects a forced landscape page for a portrait image', () => {
    const result = layout({ orientation: 'landscape' }, { width: 800, height: 1200 });
    expect(result.pageWidth).toBeCloseTo(A4.height, 2);
    expect(result.pageHeight).toBeCloseTo(A4.width, 2);
  });

  it('rotating a landscape image by 90° makes auto pick a portrait page', () => {
    const straight = layout({ orientation: 'auto' }, { width: 1200, height: 800 });
    const turned = layout({ orientation: 'auto' }, { width: 1200, height: 800 }, 90);
    expect(straight.orientation).toBe('landscape');
    expect(turned.orientation).toBe('portrait');
  });
});

describe('fit modes', () => {
  // 800 × 1200 is 0.667 aspect; A4 portrait content box is 0.707 — so contain
  // is height-limited and cover is width-limited.
  const image = { width: 800, height: 1200 };

  it('contain keeps the whole image visible and centred', () => {
    const result = layout({ fit: 'contain' }, image);
    expect(result.imageBox.height).toBeCloseTo(A4.height, 1);
    expect(result.imageBox.width).toBeCloseTo((A4.height * 2) / 3, 1);
    expect(result.imageBox.x).toBeCloseTo((A4.width - result.imageBox.width) / 2, 2);
    expect(result.clipped).toBe(false);
  });

  it('cover fills the page and overflows vertically', () => {
    const result = layout({ fit: 'cover' }, image);
    expect(result.imageBox.width).toBeCloseTo(A4.width, 1);
    expect(result.imageBox.height).toBeGreaterThan(A4.height);
    expect(result.clipped).toBe(true);
  });

  it('stretch fills the content box exactly, ignoring the aspect ratio', () => {
    const result = layout({ fit: 'stretch' }, image);
    expect(result.imageBox.width).toBeCloseTo(result.contentBox.width, 2);
    expect(result.imageBox.height).toBeCloseTo(result.contentBox.height, 2);
    expect(result.clipped).toBe(false);
  });
});

describe('margins', () => {
  const image = { width: 1000, height: 1000 };

  it('no margin uses the whole page', () => {
    const result = layout({ margin: 'none' }, image);
    expect(result.margin).toBe(0);
    expect(result.contentBox.width).toBeCloseTo(A4.width, 2);
    expect(result.contentBox.height).toBeCloseTo(A4.height, 2);
  });

  it('normal and wide margins shrink the content box symmetrically', () => {
    const normal = layout({ margin: 'normal' }, image);
    expect(normal.margin).toBeCloseTo(mmToPt(8), 3);
    expect(normal.contentBox.width).toBeCloseTo(A4.width - mmToPt(16), 2);
    expect(normal.contentBox.x).toBeCloseTo(mmToPt(8), 2);

    const wide = layout({ margin: 'wide' }, image);
    expect(wide.margin).toBeCloseTo(mmToPt(18), 3);
  });

  it('custom margins are honoured and never collapse the page', () => {
    const custom = layout({ margin: 'custom', customMarginMm: 25 }, image);
    expect(custom.margin).toBeCloseTo(mmToPt(25), 3);

    const absurd = layout({ margin: 'custom', customMarginMm: 400 }, image);
    expect(absurd.contentBox.width).toBeGreaterThanOrEqual(12);
    expect(absurd.contentBox.height).toBeGreaterThanOrEqual(12);
  });

  it('contain still fits inside the margin box', () => {
    const result = layout({ margin: 'wide' }, { width: 400, height: 4000 });
    expect(result.imageBox.height).toBeLessThanOrEqual(result.contentBox.height + 0.01);
    expect(result.imageBox.y).toBeGreaterThanOrEqual(result.contentBox.y - 0.01);
  });
});

describe('describePage', () => {
  it('reports the preset and the millimetre size', () => {
    const settings = { ...DEFAULT_SETTINGS };
    expect(describePage(settings, layout({}, { width: 800, height: 1200 }))).toBe(
      'A4 · 210 × 297 mm',
    );
    expect(
      describePage(
        { ...settings, pageSize: 'image' },
        layout({ pageSize: 'image' }, { width: 1200, height: 800 }),
      ),
    ).toContain('原始尺寸');
  });
});
