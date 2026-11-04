import { PDFName } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import { buildImagePdf } from '@/features/image-pdf/build';
import { ImagePdfCancelledError } from '@/features/image-pdf/errors';
import { computePageLayout } from '@/features/image-pdf/page-layout';
import {
  DEFAULT_SETTINGS,
  mmToPt,
  type ImageJob,
  type ImagePdfSettings,
  type Rotation,
} from '@/features/image-pdf/types';
import { makePng } from './helpers/png';
import { imageXObjects, loadDoc, pageContent } from './helpers/pdf';

function makeJob(
  id: string,
  width: number,
  height: number,
  options: { rotation?: Rotation; hasAlpha?: boolean } = {},
): ImageJob {
  return {
    id,
    name: `${id}.png`,
    file: new Blob([makePng({ width: 8, height: 6 }).slice().buffer as ArrayBuffer]),
    format: 'png',
    width,
    height,
    rotation: options.rotation ?? 0,
    hasAlpha: options.hasAlpha ?? false,
  };
}

interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Parses `1 0 0 1 x y cm … w 0 0 h 0 0 cm … /Image Do` out of a content stream. */
function imagePlacements(content: string): Placement[] {
  const placements: Placement[] = [];
  // pdf-lib draws images as `translate(x,y) … scale(w,h) … /Img Do`, so the CTM
  // in effect at the `Do` carries the placement. Composing it avoids guessing
  // which of the several `cm` operators is the meaningful one.
  let ctm = [1, 0, 0, 1, 0, 0];

  for (const line of content.split('\n').map((l) => l.trim())) {
    const cm = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm$/.exec(line);
    if (cm) {
      const [a, b, c, d, e, f] = cm.slice(1).map(Number);
      ctm = [
        ctm[0] * a + ctm[2] * b,
        ctm[1] * a + ctm[3] * b,
        ctm[0] * c + ctm[2] * d,
        ctm[1] * c + ctm[3] * d,
        ctm[0] * e + ctm[2] * f + ctm[4],
        ctm[1] * e + ctm[3] * f + ctm[5],
      ];
      continue;
    }
    if (/^\/Image[\w-]* Do$/.test(line)) {
      placements.push({ x: ctm[4], y: ctm[5], width: ctm[0], height: ctm[3] });
      ctm = [1, 0, 0, 1, 0, 0];
    }
  }

  return placements;
}

/** Test double for the canvas encoder: honest pixel sizes, no canvas needed. */
function fakeDeps(sizeOf: (job: ImageJob) => { width: number; height: number }) {
  return {
    encode: vi.fn(async (job: ImageJob, _layout: unknown, options: { forceReencode: boolean }) => {
      const size = sizeOf(job);
      return {
        bytes: makePng({
          width: size.width,
          height: size.height,
          alpha: job.hasAlpha ? 160 : undefined,
        }),
        format: 'png' as const,
        width: size.width,
        height: size.height,
        source: options.forceReencode ? ('canvas' as const) : ('original' as const),
      };
    }),
  };
}

const rotatedSize = (job: ImageJob) =>
  job.rotation % 180 === 0
    ? { width: Math.round(job.width / 20), height: Math.round(job.height / 20) }
    : { width: Math.round(job.height / 20), height: Math.round(job.width / 20) };

async function build(
  jobs: ImageJob[],
  patch: Partial<ImagePdfSettings> = {},
  options: { shouldCancel?: () => boolean } = {},
) {
  const settings = { ...DEFAULT_SETTINGS, ...patch };
  const deps = fakeDeps(rotatedSize);
  const outcome = await buildImagePdf(jobs, settings, deps, options);
  const doc = await loadDoc(outcome.bytes);
  return { outcome, doc, deps, settings };
}

describe('buildImagePdf', () => {
  it('creates one page per image, in the given order', async () => {
    const { outcome, doc } = await build([
      makeJob('portrait', 800, 1200),
      makeJob('landscape', 1600, 900),
      makeJob('square', 1000, 1000),
    ]);

    expect(outcome.pageCount).toBe(3);
    expect(doc.getPageCount()).toBe(3);
    expect(outcome.verified).toBe(true);

    const pages = doc.getPages().map((page) => page.getSize());
    expect(pages[0].height).toBeGreaterThan(pages[0].width);
    expect(pages[1].width).toBeGreaterThan(pages[1].height);
    // A square image keeps the preset's portrait page under "auto".
    expect(pages[2].height).toBeGreaterThan(pages[2].width);

    // Order is observable through the encoded pixel size of each page.
    expect(outcome.pages.map((page) => page.imageWidth)).toEqual([40, 80, 50]);
  });

  it('uses the selected page size', async () => {
    const a5 = await build([makeJob('a', 800, 1200)], { pageSize: 'a5' });
    expect(a5.doc.getPages()[0].getSize().width).toBeCloseTo(mmToPt(148), 2);

    const custom = await build([makeJob('a', 800, 1200)], {
      pageSize: 'custom',
      customWidthMm: 100,
      customHeightMm: 150,
    });
    const size = custom.doc.getPages()[0].getSize();
    expect(size.width).toBeCloseTo(mmToPt(100), 2);
    expect(size.height).toBeCloseTo(mmToPt(150), 2);

    const original = await build([makeJob('a', 1200, 800)], { pageSize: 'image' });
    const originalSize = original.doc.getPages()[0].getSize();
    expect(originalSize.width).toBeCloseTo(mmToPt(101.6), 2);
    expect(originalSize.height).toBeCloseTo(mmToPt((800 / 300) * 25.4), 2);
  });

  it('paints the page background before the image', async () => {
    const { doc } = await build([makeJob('a', 800, 1200)], { background: '#0f172a' });
    const content = pageContent(doc.getPages()[0], doc);

    const fill = /([\d.]+) ([\d.]+) ([\d.]+) rg/.exec(content);
    expect(fill).not.toBeNull();
    expect(Number(fill![1])).toBeCloseTo(15 / 255, 4);
    expect(Number(fill![2])).toBeCloseTo(23 / 255, 4);
    expect(Number(fill![3])).toBeCloseTo(42 / 255, 4);
  });

  it('draws a contained image inside the margin box without clipping', async () => {
    const { doc, settings } = await build([makeJob('a', 400, 4000)], { margin: 'normal' });
    const content = pageContent(doc.getPages()[0], doc);
    const layout = computePageLayout({
      settings,
      imageWidth: 400,
      imageHeight: 4000,
      rotation: 0,
    });

    expect(content).not.toMatch(/\bW\s+n\b/);

    const [placement] = imagePlacements(content);
    expect(placement.height).toBeCloseTo(layout.imageBox.height, 2);
    expect(placement.y).toBeGreaterThanOrEqual(layout.contentBox.y - 0.01);
  });

  it('clips a "cover" image to the content box', async () => {
    const { doc, settings } = await build([makeJob('a', 800, 1200)], { fit: 'cover' });
    const content = pageContent(doc.getPages()[0], doc);
    const layout = computePageLayout({
      settings,
      imageWidth: 800,
      imageHeight: 1200,
      rotation: 0,
    });

    const clipRect = /([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\s*\n?W\s*\n?n/.exec(content);
    expect(clipRect).not.toBeNull();
    expect(Number(clipRect![1])).toBeCloseTo(layout.contentBox.x, 2);
    expect(Number(clipRect![2])).toBeCloseTo(layout.contentBox.y, 2);
    expect(Number(clipRect![3])).toBeCloseTo(layout.contentBox.width, 2);
    expect(Number(clipRect![4])).toBeCloseTo(layout.contentBox.height, 2);

    // The image itself overflows the clip box, which is the whole point.
    const [placement] = imagePlacements(content);
    expect(placement.height).toBeGreaterThan(layout.contentBox.height);
  });

  it('stretch fills the content box exactly', async () => {
    const { doc, settings } = await build([makeJob('a', 800, 1200)], { fit: 'stretch' });
    const content = pageContent(doc.getPages()[0], doc);
    const layout = computePageLayout({
      settings,
      imageWidth: 800,
      imageHeight: 1200,
      rotation: 0,
    });

    const [placement] = imagePlacements(content);
    expect(placement.width).toBeCloseTo(layout.contentBox.width, 2);
    expect(placement.height).toBeCloseTo(layout.contentBox.height, 2);
  });

  it('keeps the alpha channel of a transparent PNG', async () => {
    const { doc } = await build([makeJob('a', 800, 800, { hasAlpha: true })]);
    const [xobject] = imageXObjects(doc.getPages()[0], doc);
    expect(xobject.dict.get(PDFName.of('SMask'))).toBeDefined();
  });

  it('stores the rotated pixel size for quarter turns', async () => {
    const straight = await build([makeJob('a', 1200, 800)]);
    const turned = await build([makeJob('a', 1200, 800, { rotation: 90 })]);

    expect(straight.outcome.pages[0].imageWidth).toBe(60);
    expect(straight.outcome.pages[0].imageHeight).toBe(40);
    expect(turned.outcome.pages[0].imageWidth).toBe(40);
    expect(turned.outcome.pages[0].imageHeight).toBe(60);

    // The page flips to portrait because the visible image is portrait now.
    expect(turned.outcome.pages[0].height).toBeGreaterThan(turned.outcome.pages[0].width);
  });

  it('cancels between images instead of finishing', async () => {
    const jobs = [makeJob('a', 800, 600), makeJob('b', 800, 600), makeJob('c', 800, 600)];
    const deps = fakeDeps(rotatedSize);
    let checks = 0;

    await expect(
      buildImagePdf(jobs, { ...DEFAULT_SETTINGS }, deps, {
        shouldCancel: () => {
          checks += 1;
          return checks > 1;
        },
      }),
    ).rejects.toBeInstanceOf(ImagePdfCancelledError);

    expect(deps.encode).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty plan', async () => {
    await expect(buildImagePdf([], { ...DEFAULT_SETTINGS }, fakeDeps(rotatedSize))).rejects.toThrow(
      /没有可转换的图片/,
    );
  });

  it('retries through the canvas when the original bytes are rejected', async () => {
    const deps = {
      encode: vi.fn(
        async (_job: ImageJob, _layout: unknown, options: { forceReencode: boolean }) => ({
          // A truncated PNG only survives the second attempt: pdf-lib throws on the first.
          bytes:
            options.forceReencode === false
              ? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
              : makePng({ width: 12, height: 12 }),
          format: 'png' as const,
          width: 12,
          height: 12,
          source: options.forceReencode ? ('canvas' as const) : ('original' as const),
        }),
      ),
    };

    const outcome = await buildImagePdf([makeJob('a', 400, 400)], { ...DEFAULT_SETTINGS }, deps);

    expect(outcome.pageCount).toBe(1);
    expect(deps.encode).toHaveBeenCalledTimes(2);
    expect(deps.encode.mock.calls[1][2]).toEqual({ forceReencode: true });
  });
});
