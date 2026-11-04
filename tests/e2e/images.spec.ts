import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { expect, test, type Page } from '@playwright/test';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef, PDFStream, type PDFPage } from 'pdf-lib';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'images');
const screenshotDir = join(process.cwd(), 'docs', 'screenshots');

const fixture = (name: string) => join(FIXTURES, name);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function openImages(page: Page) {
  await page.goto('/#/images');
  await expect(page.getByRole('heading', { name: '把图片拼成一份 PDF' })).toBeVisible();
}

async function uploadImages(page: Page, ...names: string[]) {
  await page.locator('input[type=file]').first().setInputFiles(names.map(fixture));
}

async function cardNames(page: Page): Promise<string[]> {
  return page
    .getByTestId('image-card')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-image-name') ?? ''));
}

async function expectOrder(page: Page, names: string[]) {
  await expect(page.getByTestId('image-card')).toHaveCount(names.length);
  await expect.poll(() => cardNames(page)).toEqual(names);
}

async function generate(page: Page) {
  const button = page.getByTestId('generate-button');
  // The settings panel is taller than a laptop viewport, so the button is
  // usually below the fold; bring it into view before clicking.
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeEnabled();
  await button.click();

  // Fail fast and precisely if the click did not start a build, instead of
  // waiting out the whole test timeout on the result card.
  await expect(page.getByTestId('build-progress').or(page.getByTestId('image-result'))).toBeVisible(
    { timeout: 10_000 },
  );
  await expect(page.getByTestId('image-result')).toBeVisible({ timeout: 90_000 });
}

/** Triggers the download and returns its temp path plus byte size. */
async function downloadFile(page: Page): Promise<{ path: string; size: number }> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('image-download-button').click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  return { path: path!, size: statSync(path!).size };
}

/** Triggers the download and returns the parsed PDF. */
async function downloadPdf(page: Page): Promise<PDFDocument> {
  const { path } = await downloadFile(page);
  return PDFDocument.load(readFileSync(path));
}

function resolve(doc: PDFDocument, value: unknown): unknown {
  return value instanceof PDFRef ? doc.context.lookup(value) : value;
}

function pageContent(page: PDFPage, doc: PDFDocument): string {
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return '';
  const streams: PDFStream[] = [];
  const raw = resolve(doc, contents);
  if (raw instanceof PDFArray) {
    for (let i = 0; i < raw.size(); i += 1) {
      const item = resolve(doc, raw.get(i));
      if (item instanceof PDFStream) streams.push(item);
    }
  } else if (raw instanceof PDFStream) {
    streams.push(raw);
  }

  return streams
    .map((stream) => {
      const filter = stream.dict.get(PDFName.of('Filter'));
      const bytes = (stream as unknown as { contents: Uint8Array }).contents;
      return (filter ? inflateSync(Buffer.from(bytes)) : Buffer.from(bytes)).toString('latin1');
    })
    .join('\n');
}

interface PageFacts {
  width: number;
  height: number;
  image: { width: number; height: number; hasSmask: boolean } | null;
  drawn: { width: number; height: number; x: number; y: number } | null;
  clipped: boolean;
}

/** Everything the tests need to know about one output page. */
function describePages(doc: PDFDocument): PageFacts[] {
  return doc.getPages().map((page) => {
    const size = page.getSize();
    const resources = page.node.lookup(PDFName.of('Resources'));
    let image: PageFacts['image'] = null;

    if (resources instanceof PDFDict) {
      const xobjects = resources.lookup(PDFName.of('XObject'));
      if (xobjects instanceof PDFDict) {
        for (const [, ref] of xobjects.entries()) {
          const stream = resolve(doc, ref);
          if (!(stream instanceof PDFStream)) continue;
          const subtype = stream.dict.get(PDFName.of('Subtype'));
          if (!subtype || subtype.toString() !== '/Image') continue;
          image = {
            width: Number(stream.dict.get(PDFName.of('Width'))?.toString() ?? 0),
            height: Number(stream.dict.get(PDFName.of('Height'))?.toString() ?? 0),
            hasSmask: stream.dict.get(PDFName.of('SMask')) !== undefined,
          };
          break;
        }
      }
    }

    const content = pageContent(page, doc);

    // Compose the transformation matrix in effect when the image is painted.
    let ctm = [1, 0, 0, 1, 0, 0];
    let drawn: PageFacts['drawn'] = null;
    for (const line of content.split('\n').map((l) => l.trim())) {
      const cm = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm$/.exec(
        line,
      );
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
        drawn = { x: ctm[4], y: ctm[5], width: ctm[0], height: ctm[3] };
        ctm = [1, 0, 0, 1, 0, 0];
      }
    }

    return {
      width: size.width,
      height: size.height,
      image,
      drawn,
      clipped: /\bW\s*\n?n\b/.test(content),
    };
  });
}

/** Waits for the preview dialog to render N pages with PDF.js. */
async function expectPdfPreview(page: Page, pages: number) {
  await page.getByTestId('preview-result').click();
  await expect(page.getByTestId('generated-pdf-dialog')).toBeVisible();
  await expect(page.locator('img[alt^="生成结果第"]')).toHaveCount(pages, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('generated-pdf-dialog')).toBeHidden();
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

test('工具导航：两个功能互相独立且可来回切换', async ({ page }) => {
  await page.goto('/');
  // The merge tool stays the default entry point.
  await expect(page.getByRole('heading', { name: '把多个 PDF 合成一份' })).toBeVisible();
  await expect(page.getByTestId('tool-nav-merge')).toHaveAttribute('aria-current', 'page');

  await page.getByTestId('tool-nav-images').click();
  await expect(page).toHaveURL(/#\/images$/);
  await expect(page.getByRole('heading', { name: '把图片拼成一份 PDF' })).toBeVisible();

  await uploadImages(page, 'photo-portrait.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  // Switching away and back must keep each tool's own state.
  await page.getByTestId('tool-nav-merge').click();
  await expect(page.getByRole('heading', { name: '把多个 PDF 合成一份' })).toBeVisible();
  await page.getByTestId('tool-nav-images').click();
  await expect(page.getByTestId('image-card')).toHaveCount(1);
});

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

test('导入 JPG 与 PNG：显示尺寸、大小与格式，并统计页数', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg', 'graphic.png');

  await expect(page.getByTestId('image-card')).toHaveCount(2);
  const first = page.getByTestId('image-card').first();
  await expect(first).toContainText('photo-portrait.jpg');
  await expect(first).toContainText('900 × 1350');
  await expect(first).toContainText('JPEG');
  await expect(page.getByTestId('image-card').nth(1)).toContainText('PNG');
  await expect(page.getByTestId('generate-button')).toContainText('生成 2 页 PDF');
});

test('混合格式（JPG/PNG/WebP/BMP/GIF）全部转为页面', async ({ page }) => {
  await openImages(page);
  await uploadImages(
    page,
    'photo-portrait.jpg',
    'graphic.png',
    'shot.webp',
    'scan.bmp',
    'tiny.gif',
  );
  await expect(page.getByTestId('image-card')).toHaveCount(5, { timeout: 30_000 });
  await expect(page.getByTestId('generate-button')).toContainText('生成 5 页 PDF');

  await generate(page);
  const doc = await downloadPdf(page);
  expect(doc.getPageCount()).toBe(5);
  // Every page carries exactly one real image XObject.
  for (const facts of describePages(doc)) {
    expect(facts.image).not.toBeNull();
  }
});

test('重复导入会被跳过，损坏与不支持的文件给出明确错误', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-landscape.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  await uploadImages(page, 'photo-landscape.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  await uploadImages(page, 'broken.jpg', 'not-image.png');
  await expect(page.getByTestId('image-card-error')).toHaveCount(2, { timeout: 20_000 });
  await expect(page.getByTestId('image-card-error').first()).toContainText('无法解码');
  await expect(page.getByTestId('image-card-error').nth(1)).toContainText('无法识别');
  await expect(page.getByTestId('generate-button')).toContainText('生成 1 页 PDF');
});

/* -------------------------------------------------------------------------- */
/* Order, rotation, deletion                                                  */
/* -------------------------------------------------------------------------- */

test('拖拽排序会改变输出页面的顺序', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg', 'photo-landscape.jpg', 'shot.webp');
  await expectOrder(page, ['photo-portrait.jpg', 'photo-landscape.jpg', 'shot.webp']);
  // Let the toast/animation settle: a moving target under the pointer cancels
  // the drag before it starts.
  await page.waitForTimeout(400);

  const cards = page.getByTestId('image-card');
  const handle = cards.first().getByRole('button', { name: /拖拽调整/ });
  const from = await handle.boundingBox();
  const to = await cards.nth(2).boundingBox();
  expect(from && to).toBeTruthy();

  // dnd-kit needs the pointer to travel past its 6 px activation distance and
  // then receive real movement events, so the drag is stepped deliberately.
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2 + 2, from!.y + from!.height / 2 + 2);
  await page.waitForTimeout(120);
  await page.mouse.move(from!.x + 30, from!.y + 30, { steps: 6 });
  await page.waitForTimeout(150);
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 20 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  // Let the drop animation finish before reading the DOM order.
  await page.waitForTimeout(400);

  await expectOrder(page, ['photo-landscape.jpg', 'shot.webp', 'photo-portrait.jpg']);

  await generate(page);
  const doc = await downloadPdf(page);
  const pages = describePages(doc);
  // 900×1350 portrait photo now comes last: its page is the only portrait A4
  // page among 1600×900 and 1024×640 landscape ones.
  expect(pages[2].height).toBeGreaterThan(pages[2].width);
  expect(pages[0].width).toBeGreaterThan(pages[0].height);
});

test('旋转 90° 真实改变输出：页面转横向、图片像素也旋转', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  const card = page.getByTestId('image-card').first();
  await card.getByTestId('rotate-right').click();
  await expect(card).toHaveAttribute('data-rotation', '90');
  // Auto orientation follows the rotated aspect: the preview page turns landscape.
  await expect(page.getByTestId('page-preview')).toHaveAttribute('data-page-width', /^29[67]/);

  await generate(page);
  const doc = await downloadPdf(page);
  const [facts] = describePages(doc);

  expect(facts.width).toBeGreaterThan(facts.height);
  expect(facts.image).not.toBeNull();
  // 900×1350 rotated becomes 1350×900 — proof the pixels were really rotated.
  expect(facts.image!.width).toBeGreaterThan(facts.image!.height);
});

test('删除图片会减少输出页数', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg', 'photo-landscape.jpg', 'graphic.png');
  await expect(page.getByTestId('image-card')).toHaveCount(3);

  await page.getByTestId('image-card').nth(1).getByTestId('delete-image').click();
  await expect(page.getByTestId('image-card')).toHaveCount(2);
  await expect(page.getByTestId('generate-button')).toContainText('生成 2 页 PDF');

  await generate(page);
  const doc = await downloadPdf(page);
  expect(doc.getPageCount()).toBe(2);
});

/* -------------------------------------------------------------------------- */
/* Page settings                                                              */
/* -------------------------------------------------------------------------- */

test('页面尺寸：A5 / 自定义 / 原图尺寸（300 DPI）', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  // A5
  await page.getByRole('button', { name: 'A5', exact: true }).click();
  await generate(page);
  let doc = await downloadPdf(page);
  let [facts] = describePages(doc);
  expect(facts.width).toBeCloseTo((148 / 25.4) * 72, 1);
  expect(facts.height).toBeCloseTo((210 / 25.4) * 72, 1);

  // Custom 100 × 150 mm
  await page.getByRole('button', { name: '自定义', exact: true }).click();
  await page.getByTestId('custom-width').fill('100');
  await page.getByTestId('custom-height').fill('150');
  await page.getByTestId('image-output-name').click();
  await generate(page);
  doc = await downloadPdf(page);
  [facts] = describePages(doc);
  expect(facts.width).toBeCloseTo((100 / 25.4) * 72, 1);
  expect(facts.height).toBeCloseTo((150 / 25.4) * 72, 1);

  // Original size at 300 DPI: 900 px → 76.2 mm, 1350 px → 114.3 mm
  await page.getByRole('button', { name: '原图尺寸', exact: true }).click();
  await expect(page.getByTestId('image-dpi')).toHaveValue('300');
  await generate(page);
  doc = await downloadPdf(page);
  [facts] = describePages(doc);
  expect(facts.width).toBeCloseTo((900 / 300) * 72, 1);
  expect(facts.height).toBeCloseTo((1350 / 300) * 72, 1);
});

test('三种适配方式产生不同的排版：完整显示 / 填满（裁剪）/ 拉伸', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  // contain: image is inside the page, nothing clipped
  await page.getByRole('button', { name: '完整显示', exact: true }).click();
  await generate(page);
  let [facts] = describePages(await downloadPdf(page));
  const pageWidth = (210 / 25.4) * 72;
  expect(facts.clipped).toBe(false);
  expect(facts.drawn!.height).toBeCloseTo(facts.height, 0);
  expect(facts.drawn!.width).toBeLessThan(pageWidth - 1);

  // cover: overflow is clipped to the content box
  await page.getByRole('button', { name: '填满页面', exact: true }).click();
  await generate(page);
  [facts] = describePages(await downloadPdf(page));
  expect(facts.clipped).toBe(true);
  expect(facts.drawn!.width).toBeCloseTo(pageWidth, 0);
  expect(facts.drawn!.height).toBeGreaterThan(facts.height);

  // stretch: exactly the page box, no clip
  await page.getByRole('button', { name: '拉伸铺满', exact: true }).click();
  await generate(page);
  [facts] = describePages(await downloadPdf(page));
  expect(facts.clipped).toBe(false);
  expect(facts.drawn!.width).toBeCloseTo(pageWidth, 0);
  expect(facts.drawn!.height).toBeCloseTo(facts.height, 0);
});

test('页边距会缩小图片可用的区域', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-landscape.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  await page.getByRole('button', { name: '无边距', exact: true }).click();
  await generate(page);
  const noMargin = describePages(await downloadPdf(page))[0];

  await page.getByRole('button', { name: '宽', exact: true }).click();
  await generate(page);
  const wide = describePages(await downloadPdf(page))[0];

  const pageWidth = (297 / 25.4) * 72; // landscape A4
  const wideMarginPt = (18 / 25.4) * 72;
  expect(noMargin.drawn!.width).toBeCloseTo(pageWidth, 0);
  expect(wide.drawn!.width).toBeLessThan(noMargin.drawn!.width);
  expect(wide.drawn!.width).toBeLessThanOrEqual(pageWidth - wideMarginPt * 2 + 0.5);
  expect(wide.drawn!.x).toBeGreaterThan(wideMarginPt - 0.5);
});

test('预览的裁剪范围与引擎一致（内容区，而不是页面边缘）', async ({ page }) => {
  await openImages(page);
  // A landscape photo on an auto-oriented A4 page: 16:9 into a 1.5:1 box, so
  // "cover" really does overflow (a 2:3 photo would match A4 exactly).
  await uploadImages(page, 'photo-landscape.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  await page.getByRole('button', { name: '填满页面', exact: true }).click();
  await page.getByRole('button', { name: '宽', exact: true }).click();
  await page.waitForTimeout(300);

  const geometry = await page.evaluate(() => {
    const pageEl = document.querySelector('[data-testid="page-preview"]');
    const img = pageEl?.querySelector('img');
    if (!pageEl || !img) return null;

    let clip: HTMLElement | null = img.parentElement;
    while (clip && clip !== pageEl && getComputedStyle(clip).overflow === 'visible') {
      clip = clip.parentElement;
    }
    if (!clip || clip === pageEl) return null;

    const p = pageEl.getBoundingClientRect();
    const c = clip.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    return {
      pageWidth: p.width,
      pageHeight: p.height,
      insetLeft: c.left - p.left,
      insetTop: c.top - p.top,
      // cover may overflow on either axis; the visible crop is what matters.
      imageOverflow: Math.max(i.width - c.width, i.height - c.height),
    };
  });

  expect(geometry).not.toBeNull();
  // The page turned landscape (297 × 210 mm); the clip box is inset by 18 mm.
  expect(geometry!.pageWidth).toBeGreaterThan(geometry!.pageHeight);
  expect(geometry!.insetLeft / geometry!.pageWidth).toBeCloseTo(18 / 297, 2);
  expect(geometry!.insetTop / geometry!.pageHeight).toBeCloseTo(18 / 210, 2);
  // The image is larger than its clip box — that is what "cropped" means.
  expect(geometry!.imageOverflow).toBeGreaterThan(1);
});

test('透明 PNG 保留 alpha，并落在选定的背景色上', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'graphic.png');
  await expect(page.getByTestId('image-card')).toHaveCount(1);

  await page.getByRole('button', { name: '背景 深色' }).click();
  await generate(page);
  const doc = await downloadPdf(page);
  const [facts] = describePages(doc);

  expect(facts.image?.hasSmask).toBe(true);
  // The page paints the chosen background before the image.
  const content = pageContent(doc.getPages()[0], doc);
  const fill = /([\d.]+) ([\d.]+) ([\d.]+) rg/.exec(content);
  expect(fill).not.toBeNull();
  expect(Number(fill![1])).toBeCloseTo(15 / 255, 3);
});

test('输出质量：压缩明显小于高质量，但页数一致', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'huge.jpg');
  await expect(page.getByTestId('image-card')).toContainText('4000 × 3000', { timeout: 30_000 });

  await page.getByRole('button', { name: '高质量', exact: true }).click();
  await generate(page);
  const high = await downloadFile(page);
  const highDoc = await PDFDocument.load(readFileSync(high.path));

  await page.getByRole('button', { name: '压缩', exact: true }).click();
  await generate(page);
  const compressed = await downloadFile(page);
  const compressedDoc = await PDFDocument.load(readFileSync(compressed.path));

  expect(highDoc.getPageCount()).toBe(1);
  expect(compressedDoc.getPageCount()).toBe(1);

  // The embedded bitmap must actually shrink, and so must the file.
  const highImage = describePages(highDoc)[0].image!;
  const compressedImage = describePages(compressedDoc)[0].image!;
  expect(compressedImage.width).toBeLessThan(highImage.width);
  expect(compressedImage.height).toBeLessThan(highImage.height);
  expect(compressed.size).toBeLessThan(high.size);
});

/* -------------------------------------------------------------------------- */
/* Output                                                                     */
/* -------------------------------------------------------------------------- */

test('缺少 OffscreenCanvas 时自动降级到主线程，仍能生成', async ({ page }) => {
  // Simulate a browser without the offscreen API (older Safari/WebKit): the
  // engine must fall back to a DOM canvas instead of failing.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'OffscreenCanvas', { value: undefined, configurable: true });
  });

  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByTestId('fallback-hint')).toBeVisible();

  await generate(page);
  const doc = await downloadPdf(page);
  expect(doc.getPageCount()).toBe(1);
});

test('生成结果可用 PDF.js 逐页渲染预览', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg', 'photo-landscape.jpg');
  await generate(page);
  await expectPdfPreview(page, 2);
});

test('可修改输出文件名并下载', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'photo-landscape.jpg');
  await page.getByTestId('image-output-name').fill('旅行照片合集');
  await generate(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('image-download-button').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('旅行照片合集.pdf');
});

test('中途取消不会产生结果卡片', async ({ page }) => {
  await openImages(page);
  await uploadImages(page, 'huge.jpg', 'photo-portrait.jpg', 'photo-landscape.jpg', 'graphic.png');
  await expect(page.getByTestId('image-card')).toHaveCount(4, { timeout: 30_000 });

  await page.getByTestId('generate-button').click();
  // Cancel as soon as the build reports progress; the worker stops at the next
  // image boundary.
  await page
    .getByRole('button', { name: '取消' })
    .click({ timeout: 10_000 })
    .catch(() => undefined);

  await expect(page.getByTestId('image-result')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('generate-button')).toBeVisible({ timeout: 30_000 });
});

test('导入与生成全程只有同源 GET 请求（无上传）', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    outbound.push(`${request.method()} ${url}`);
  });

  await openImages(page);
  await page.waitForLoadState('networkidle');
  const baseline = outbound.length;
  const origin = new URL(page.url()).origin;

  await uploadImages(page, 'photo-portrait.jpg', 'graphic.png');
  await expect(page.getByTestId('image-card')).toHaveCount(2, { timeout: 30_000 });
  await generate(page);
  await expectPdfPreview(page, 2);
  await page.waitForTimeout(500);

  const during = outbound.slice(baseline);
  expect(during.length).toBeGreaterThan(0);
  for (const entry of during) {
    const [method, url] = entry.split(' ');
    expect(method).toBe('GET');
    expect(new URL(url).origin).toBe(origin);
  }
});

test('手机尺寸（390×844）可完成整条流程且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openImages(page);
  await uploadImages(page, 'photo-portrait.jpg', 'photo-landscape.jpg');
  await expect(page.getByTestId('image-card')).toHaveCount(2, { timeout: 30_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '生成 PDF' }).click();
  await expect(page.getByTestId('image-result')).toBeVisible({ timeout: 90_000 });

  const doc = await downloadPdf(page);
  expect(doc.getPageCount()).toBe(2);
});

/* -------------------------------------------------------------------------- */
/* Screenshots                                                                */
/* -------------------------------------------------------------------------- */

test('界面截图：空状态、工作区、深色、结果与预览', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '截图只需生成一次，固定使用 Chromium');

  await page.goto('/#/images');
  await expect(page.getByRole('heading', { name: '把图片拼成一份 PDF' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(screenshotDir, '08-images-empty.png') });

  await uploadImages(page, 'photo-portrait.jpg', 'photo-landscape.jpg', 'graphic.png');
  await expect(page.getByTestId('image-card')).toHaveCount(3, { timeout: 30_000 });
  await page
    .locator('[data-sonner-toast]')
    .first()
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => undefined);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(screenshotDir, '09-images-workspace.png') });

  await page.getByRole('button', { name: '填满页面', exact: true }).click();
  await page.getByRole('button', { name: '普通', exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(screenshotDir, '10-images-cover.png') });

  await page.getByRole('button', { name: '切换到深色模式' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(screenshotDir, '11-images-dark.png') });

  await page.getByRole('button', { name: '切换到浅色模式' }).click();
  await page.getByRole('button', { name: '完整显示', exact: true }).click();
  await generate(page);
  // Toasts are transient feedback; keep them out of the documentation shots.
  await page
    .locator('[data-sonner-toast]')
    .first()
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(screenshotDir, '12-images-result.png') });

  await page.getByTestId('preview-result').click();
  await expect(page.getByTestId('generated-pdf-dialog')).toBeVisible();
  await expect(page.locator('img[alt^="生成结果第"]')).toHaveCount(3, { timeout: 30_000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(screenshotDir, '13-images-pdf-preview.png') });
});
