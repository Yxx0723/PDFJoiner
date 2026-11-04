import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
const SCREENSHOTS = join(process.cwd(), 'docs', 'screenshots');

async function upload(page: Page, ...files: string[]) {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(files.map((name) => join(FIXTURES, name)));
}

async function cardNames(page: Page): Promise<string[]> {
  return page
    .getByTestId('file-card')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-file-name') ?? ''));
}

/** Waits for the cards to render, then asserts their order. */
async function expectCardOrder(page: Page, names: string[]) {
  await expect(page.getByTestId('file-card')).toHaveCount(names.length);
  await expect.poll(() => cardNames(page)).toEqual(names);
}

async function shot(page: Page, name: string) {
  mkdirSync(SCREENSHOTS, { recursive: true });
  // Toasts are transient feedback; keep them out of the marketing screenshots.
  await page
    .locator('[data-sonner-toast]')
    .first()
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => undefined);
  await page.screenshot({ path: join(SCREENSHOTS, `${name}.png`), fullPage: false });
}

test.describe.configure({ mode: 'serial' });

test('空状态：导入区、隐私说明与禁用状态', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '把多个 PDF 合成一份' })).toBeVisible();
  await expect(page.getByText('文件不会离开这台设备')).toBeVisible();
  await expect(page.getByText('零上传、零第三方请求')).toBeVisible();
  await expect(page.getByTestId('merge-button')).toHaveCount(0); // sidebar only appears with files

  await shot(page, '01-empty-light');
});

test('导入多个 PDF 并显示页数与合并顺序', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'report-a.pdf', 'report-b.pdf');

  await expectCardOrder(page, ['report-a.pdf', 'report-b.pdf']);

  const first = page.getByTestId('file-card').first();
  await expect(first).toContainText('3 页');
  await expect(first).toContainText('合并 3 页');

  await expect(page.getByTestId('merge-button')).toContainText('合并 5 页 PDF');
  await expect(page.getByTestId('merge-button')).toBeEnabled();

  // Mixed page sizes are surfaced as a caveat rather than silently ignored.
  await expect(page.getByTestId('file-card').nth(1)).toContainText('不同纸张尺寸');
});

test('页面缩略图按需渲染并可放大预览', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'report-a.pdf');

  // A single import auto-expands the page strip.
  const thumb = page.locator('img[alt="第 1 页缩略图"]').first();
  await expect(thumb).toBeVisible({ timeout: 30_000 });
  await expect(thumb).toHaveAttribute('src', /^data:image\//);

  await page.getByRole('button', { name: '预览第 1 页' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('第 1 / 3 页');

  // Regression guard: the entrance animation once overwrote the translate()
  // that centres the dialog, anchoring it at the bottom-right of the viewport.
  await page.waitForTimeout(350);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - viewport!.width / 2)).toBeLessThan(2);
  expect(Math.abs(box!.y + box!.height / 2 - viewport!.height / 2)).toBeLessThan(2);

  // Keyboard navigation inside the preview.
  await page.keyboard.press('ArrowRight');
  await expect(dialog).toContainText('第 2 / 3 页');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('预览支持缩放：按钮、双击与快捷键', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'report-a.pdf');
  await expect(page.locator('img[alt="第 1 页缩略图"]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '预览第 1 页' }).click();

  const dialog = page.getByRole('dialog');
  const level = page.getByTestId('zoom-level');
  const image = dialog.locator('img[alt="第 1 页"]');
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);

  const fitLabel = (await level.textContent())!.trim();
  const fitWidth = (await image.boundingBox())!.width;
  expect(fitLabel).toMatch(/^\d+%$/);
  expect(fitWidth).toBeGreaterThan(100);

  await dialog.getByRole('button', { name: '放大' }).click();
  await expect(level).not.toHaveText(fitLabel);
  await expect
    .poll(async () => Math.round((await image.boundingBox())!.width))
    .toBeGreaterThan(Math.round(fitWidth));

  // 1:1 means actual size: 595.28 pt x 96/72 ~= 794 CSS px.
  await dialog.getByRole('button', { name: '实际大小' }).click();
  await expect(level).toHaveText('100%');
  await expect
    .poll(async () => Math.round((await image.boundingBox())!.width))
    .toBe(794);

  // Keyboard: "-" steps down one zoom level.
  await page.keyboard.press('Minus');
  await expect(level).toHaveText('80%');

  // Back to fit restores the original geometry.
  await dialog.getByRole('button', { name: '适应窗口' }).click();
  await expect(level).toHaveText(fitLabel);
  await expect
    .poll(async () => Math.round((await image.boundingBox())!.width))
    .toBe(Math.round(fitWidth));

  // Double click toggles fit <-> 100%.
  await image.dblclick();
  await expect(level).toHaveText('100%');
  await image.dblclick();
  await expect(level).toHaveText(fitLabel);
});

test('逐页取消选择会改变合并页数', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'report-a.pdf');

  await expect(page.locator('img[alt="第 1 页缩略图"]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '取消选择第 2 页' }).click();

  await expect(page.getByTestId('merge-button')).toContainText('合并 2 页 PDF');
  await page.getByRole('button', { name: '选择第 2 页' }).click();
  await expect(page.getByTestId('merge-button')).toContainText('合并 3 页 PDF');
});

test('页码范围支持多段与校验', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'report-a.pdf', 'report-b.pdf');

  const second = page.getByTestId('file-card').nth(1);
  await second.getByTestId('toggle-pages').click();

  const range = second.getByTestId('range-input');
  await range.fill('2');
  await expect(page.getByTestId('merge-button')).toContainText('合并 4 页 PDF');

  await range.fill('1-9');
  await expect(second).toContainText('页码 9 超出范围');
  await expect(page.getByTestId('merge-button')).toBeDisabled();

  await range.fill('2,1');
  await expect(page.getByTestId('merge-button')).toContainText('合并 4 页 PDF');
  await expect(page.getByTestId('merge-button')).toBeEnabled();
});

test('合并、下载并校验输出页数与页面尺寸', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'report-a.pdf', 'report-b.pdf');

  const second = page.getByTestId('file-card').nth(1);
  await second.getByTestId('toggle-pages').click();
  await second.getByTestId('range-input').fill('2');
  await expect(page.getByTestId('merge-button')).toContainText('合并 4 页 PDF');

  await page.getByLabel('输出文件名').fill('季度报告');
  await page.getByTestId('merge-button').click();

  const result = page.locator('#merge-result');
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(result).toContainText('合并完成');
  await expect(result).toContainText('4 页');
  await expect(result).toContainText('输出已二次校验');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-button').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('季度报告.pdf');

  const saved = await download.path();
  expect(saved).toBeTruthy();
  const bytes = readFileSync(saved!);
  expect(bytes.byteLength).toBeGreaterThan(1000);

  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(4);

  const sizes = doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [Math.round(width), Math.round(height)];
  });
  // report-a pages 1-3 (A4) followed by report-b page 2 (landscape A4).
  expect(sizes).toEqual([
    [595, 842],
    [595, 842],
    [595, 842],
    [842, 595],
  ]);
});

test('加密 PDF 会被明确拒绝，而不是假装解密', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'encrypted.pdf');

  const card = page.getByTestId('file-card-error');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('已加密');
  await expect(card).toContainText('第一版不支持加密 PDF');
  await expect(page.getByTestId('merge-button')).toBeDisabled();
});

test('损坏或非 PDF 文件给出错误而不是崩溃', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'broken.pdf', 'not-a-pdf.pdf');

  await expect(page.getByTestId('file-card-error')).toHaveCount(2);
  await expect(page.getByTestId('file-card-error').first()).toContainText('无法解析');
  await expect(page.getByTestId('merge-button')).toBeDisabled();
});

test('重复导入同一个文件会被跳过', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'report-a.pdf');
  await expect(page.getByTestId('file-card')).toHaveCount(1);

  await upload(page, 'report-a.pdf');
  await expect(page.getByTestId('file-card')).toHaveCount(1);
  await expect(page.getByText(/重复文件已跳过/)).toBeVisible();
});

test('上移/下移会改变最终合并顺序', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'report-a.pdf', 'report-b.pdf');

  await expectCardOrder(page, ['report-a.pdf', 'report-b.pdf']);

  await page.getByTestId('file-card').first().getByTestId('move-down').click();
  await expectCardOrder(page, ['report-b.pdf', 'report-a.pdf']);

  await page.getByTestId('file-card').nth(1).getByTestId('move-up').click();
  await expectCardOrder(page, ['report-a.pdf', 'report-b.pdf']);
});

test('导入与合并全程只有同源 GET 请求（无上传）', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    outbound.push(`${request.method()} ${url}`);
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const baseline = outbound.length;
  const origin = new URL(page.url()).origin;

  await upload(page, 'report-a.pdf');
  await expect(page.locator('img[alt="第 1 页缩略图"]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('merge-button').click();
  await expect(page.locator('#merge-result')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(400);

  const during = outbound.slice(baseline);

  // pdf.js fetches its own worker/font assets, so there must be some traffic…
  expect(during.length).toBeGreaterThan(0);

  for (const entry of during) {
    const [method, url] = entry.split(' ');
    // …but never an upload: same origin, GET only.
    expect(method).toBe('GET');
    expect(new URL(url).origin).toBe(origin);
  }
});

test('手机尺寸（390×844）可完成合并且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await upload(page, 'report-a.pdf', 'report-b.pdf');

  // No horizontal scrollbar at phone width.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const bar = page.getByRole('button', { name: '合并并下载' });
  await expect(bar).toBeVisible();
  await bar.click();

  const result = page.locator('#merge-result');
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(result).toContainText('5 页');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-button').click();
  const download = await downloadPromise;
  const doc = await PDFDocument.load(readFileSync((await download.path())!));
  expect(doc.getPageCount()).toBe(5);
});

test('300 页文档：进度可见、完整合并、页数正确', async ({ page }) => {
  await page.goto('/');
  await upload(page, 'large-300.pdf');

  await expect(page.getByTestId('file-card')).toContainText('300 页');
  await expect(page.getByTestId('merge-button')).toContainText('合并 300 页 PDF');

  await page.getByTestId('merge-button').click();

  // Real, page-based progress — never a fabricated byte percentage.
  const progress = page.getByRole('progressbar');
  await expect(progress).toBeVisible({ timeout: 8000 });
  await expect(progress).toHaveAttribute('aria-valuemax', '300');

  const result = page.locator('#merge-result');
  await expect(result).toBeVisible({ timeout: 90_000 });
  await expect(result).toContainText('300 页');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-button').click();
  const download = await downloadPromise;
  const saved = await download.path();
  const doc = await PDFDocument.load(readFileSync(saved!));
  expect(doc.getPageCount()).toBe(300);
});

test('界面截图：工作区、深色模式与移动端', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '截图只需生成一次，固定使用 Chromium');
  // Empty state on a phone-sized viewport first (no files yet, so no
  // beforeunload prompt when resizing/gotoing below).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForTimeout(300);
  await shot(page, '06-mobile-empty');

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await upload(page, 'report-a.pdf', 'report-b.pdf');

  const first = page.getByTestId('file-card').first();
  await first.getByTestId('toggle-pages').click();
  await expect(page.locator('img[alt="第 1 页缩略图"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, '02-workspace-light');

  // Preview dialog at 100%, showing the zoom controls.
  await page.getByRole('button', { name: '预览第 1 页' }).click();
  const preview = page.getByRole('dialog');
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: '实际大小' }).click();
  await page.waitForTimeout(700);
  await shot(page, '07-preview-zoom');
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();

  await page.getByRole('button', { name: '切换到深色模式' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.waitForTimeout(400);
  await shot(page, '03-workspace-dark');

  // Back to light and produce the success state screenshot.
  await page.getByRole('button', { name: '切换到浅色模式' }).click();
  await page.getByTestId('merge-button').click();
  await expect(page.locator('#merge-result')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(400);
  await shot(page, '04-success-light');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await shot(page, '05-mobile-result');
});
