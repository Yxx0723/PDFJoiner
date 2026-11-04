import { describe, expect, it } from 'vitest';

import { hexToRgb } from '@/features/image-pdf/build';
import { drawRotated, targetPixels, type Ctx2D } from '@/features/image-pdf/encode';
import { computePageLayout } from '@/features/image-pdf/page-layout';
import { DEFAULT_SETTINGS, type Rotation } from '@/features/image-pdf/types';

type Matrix = [number, number, number, number, number, number];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * Records the transform stack and returns the matrix in effect when the image
 * was drawn. This proves the rotation math without any canvas implementation:
 * we replay exactly the same operations a real 2D context would receive.
 */
function recordDraw(rotation: Rotation, destWidth: number, destHeight: number) {
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let drawn: { width: number; height: number } | null = null;
  let matrixAtDraw: Matrix | null = null;

  const ctx = {
    save: () => {
      stack.push([...ctm] as Matrix);
    },
    restore: () => {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    },
    translate: (x: number, y: number) => {
      ctm = multiply(ctm, [1, 0, 0, 1, x, y]);
    },
    rotate: (angle: number) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctm = multiply(ctm, [cos, sin, -sin, cos, 0, 0]);
    },
    drawImage: (_src: unknown, _x: number, _y: number, width: number, height: number) => {
      drawn = { width, height };
      matrixAtDraw = [...ctm] as Matrix;
    },
  };

  drawRotated(ctx as unknown as Ctx2D, {} as CanvasImageSource, rotation, destWidth, destHeight);

  if (!drawn || !matrixAtDraw) throw new Error('drawImage was never called');
  return { drawn: drawn as { width: number; height: number }, matrix: matrixAtDraw as Matrix };
}

function boundingBox(matrix: Matrix, width: number, height: number) {
  const corners = [
    apply(matrix, 0, 0),
    apply(matrix, width, 0),
    apply(matrix, width, height),
    apply(matrix, 0, height),
  ];
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
}

describe('drawRotated', () => {
  const cases: Array<{ rotation: Rotation; dest: [number, number] }> = [
    { rotation: 0, dest: [400, 300] },
    { rotation: 90, dest: [300, 400] },
    { rotation: 180, dest: [400, 300] },
    { rotation: 270, dest: [300, 400] },
  ];

  for (const { rotation, dest } of cases) {
    it(`fills exactly ${dest[0]}×${dest[1]} at ${rotation}°`, () => {
      const { drawn, matrix } = recordDraw(rotation, dest[0], dest[1]);
      const box = boundingBox(matrix, drawn.width, drawn.height);

      // The drawn rectangle must cover the canvas exactly: no crop, no gap.
      expect(box.minX).toBeCloseTo(0, 6);
      expect(box.minY).toBeCloseTo(0, 6);
      expect(box.maxX).toBeCloseTo(dest[0], 6);
      expect(box.maxY).toBeCloseTo(dest[1], 6);
    });
  }

  it('swaps the drawImage axes for quarter turns', () => {
    // Portrait source 400×300 rendered into a 300×400 canvas.
    expect(recordDraw(90, 300, 400).drawn).toEqual({ width: 400, height: 300 });
    expect(recordDraw(0, 400, 300).drawn).toEqual({ width: 400, height: 300 });
  });
});

describe('targetPixels', () => {
  const settings = { ...DEFAULT_SETTINGS };
  const job = { width: 4000, height: 3000, rotation: 0 as Rotation };

  it('caps the pixel width by the target DPI at the placed size', () => {
    const layout = computePageLayout({
      settings,
      imageWidth: job.width,
      imageHeight: job.height,
      rotation: 0,
    });
    const standard = targetPixels(job, layout, settings);
    // A landscape photo on a landscape page: 11.02 in × 200 DPI ≈ 2204 px.
    expect(standard.width).toBeLessThan(4000);
    expect(standard.width).toBeGreaterThan(2000);
    expect(standard.dpi).toBe(200);

    const high = targetPixels(job, layout, { ...settings, quality: 'high' });
    expect(high.width).toBeGreaterThan(standard.width);

    const compressed = targetPixels(job, layout, { ...settings, quality: 'compressed' });
    expect(compressed.width).toBeLessThan(standard.width);
  });

  it('never upscales a small image', () => {
    const small = { width: 320, height: 240, rotation: 0 as Rotation };
    const layout = computePageLayout({
      settings,
      imageWidth: small.width,
      imageHeight: small.height,
      rotation: 0,
    });
    const target = targetPixels(small, layout, { ...settings, quality: 'high' });
    expect(target.width).toBe(320);
    expect(target.height).toBe(240);
  });

  it('follows the rotated aspect ratio', () => {
    const layout = computePageLayout({
      settings,
      imageWidth: job.width,
      imageHeight: job.height,
      rotation: 90,
    });
    const target = targetPixels({ ...job, rotation: 90 }, layout, settings);
    expect(target.width / target.height).toBeCloseTo(3000 / 4000, 2);
  });

  it('stops at the canvas pixel ceiling', () => {
    const huge = { width: 20000, height: 15000, rotation: 0 as Rotation };
    const bigSettings = {
      ...settings,
      pageSize: 'custom' as const,
      customWidthMm: 2000,
      customHeightMm: 2000,
      quality: 'high' as const,
    };
    const layout = computePageLayout({
      settings: bigSettings,
      imageWidth: huge.width,
      imageHeight: huge.height,
      rotation: 0,
    });
    const target = targetPixels(huge, layout, bigSettings);
    expect(target.width * target.height).toBeLessThanOrEqual(32_000_000);
    expect(target.width / target.height).toBeCloseTo(4 / 3, 2);
  });
});

describe('hexToRgb', () => {
  it('parses 6-digit and 3-digit hex', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    const red = hexToRgb('#ff0000');
    expect(red.r).toBe(1);
    expect(red.g).toBe(0);
  });

  it('falls back to white for garbage input', () => {
    expect(hexToRgb('not-a-colour')).toEqual({ r: 1, g: 1, b: 1 });
  });
});
