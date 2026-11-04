import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

import { loadDoc, pageText } from '../unit/helpers/pdf';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
const SCREENSHOTS = join(process.cwd(), 'docs', 'screenshots');

const fixture = (name: string) => join(FIXTURES, name);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function openSplit(page: Page) {
  await page.goto('/#/split');
  await expect(page.getByRole('heading', { name: '把一份 PDF 拆成多份' })).toBeVisible();
}

async function upload(page: Page, name: string) {
  await page.locator('input[type=file]').first().setInputFiles(fixture(name));
}

async function loadDocument(page: Page, name: string, pageCount: number) {
  await openSplit(page);
  await upload(page, name);
  await expect(page.getByTestId('split-document')).toContainText(name);
  await expect(page.getByTestId('split-document')).toContainText(`${pageCount} 页`, {
    timeout: 30_000,
  });
  await expect(page.getByTestId('split-page-grid')).toBeVisible();
}

async function split(page: Page) {
  const button = page.getByTestId('split-button');
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeEnabled();
  await button.click();

  // Fail fast when the click did not start a build at all.
  await expect(
    page.getByTestId('split-progress').or(page.getByTestId('split-result')).or(
      page.getByTestId('split-error'),
    ),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('split-result')).toBeVisible({ timeout: 120_000 });
}

async function downloadNth(page: Page, index: number) {
  const pending = page.waitForEvent('download');
  await page.getByTestId('split-download').nth(index).click();
  const download = await pending;
  return { path: (await download.path())!, name: download.suggestedFilename() };
}

/** Page labels (`T-3`, `H-12`, …) of an output file, in document order. */
async function labelsOf(path: string): Promise<string[]> {
  const doc = await loadDoc(new Uint8Array(readFileSync(path)));
  return doc
    .getPages()
    .map((page) => pageText(page, doc).split('\n').find((line) => /^[TH]-\d+$/.test(line)) ?? '');
}

async function shot(page: Page, name: string) {
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page
    .locator('[data-sonner-toast]')
    .first()
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => undefined);
  await page.screenshot({ path: join(SCREENSHOTS, `${name}.png`), fullPage: false });
}

test.describe.configure({ mode: 'serial' });

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

test('顶部导航三个工具互通，拆分是独立页面', async ({ page }) => {
  await page.goto('/#/merge');
  await expect(page.getByTestId('tool-nav-merge')).toBeVisible();
  await expect(page.getByTestId('tool-nav-images')).toBeVisible();
  await expect(page.getByTestId('tool-nav-split')).toBeVisible();

  await page.getByTestId('tool-nav-split').click();
  await expect(page.getByRole('heading', { name: '把一份 PDF 拆成多份' })).toBeVisible();
  await expect(page).toHaveURL(/#\/split$/);

  await page.getByTestId('tool-nav-merge').click();
  await expect(page.getByRole('heading', { name: '把多个 PDF 合成一份' })).toBeVisible();

  await page.getByTestId('tool-nav-split').click();
  await expect(page.getByRole('heading', { name: '把一份 PDF 拆成多份' })).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

test('载入 PDF 后显示页数、缩略图与预计输出', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);

  await expect(page.getByTestId('split-plan-summary')).toHaveText('2 个文件 · 10 页');
  await expect(page.getByTestId('split-button')).toContainText('拆分为 2 个文件');
  await expect(page.locator('[data-testid="split-page-grid"] img')).toHaveCount(10, {
    timeout: 30_000,
  });
  // Thumbnails are real renders, not placeholders.
  await expect
    .poll(async () => page.locator('[data-testid="split-page-grid"] img').first().boundingBox())
    .not.toBeNull();
});

test('加密 PDF 与损坏文件都被明确拒绝', async ({ page }) => {
  await openSplit(page);

  await upload(page, 'encrypted.pdf');
  await expect(page.getByTestId('split-document')).toContainText('加密', { timeout: 30_000 });
  await expect(page.getByTestId('split-button')).toBeDisabled();

  await upload(page, 'broken.pdf');
  await expect(page.getByTestId('split-document')).toContainText('损坏', { timeout: 30_000 });

  // A file that is not a PDF at all is refused before it becomes the document:
  // the previous document stays, and the rejection is reported as a toast.
  await upload(page, 'not-a-pdf.pdf');
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '不是 PDF' }).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('split-document')).toContainText('broken.pdf');
});

/* -------------------------------------------------------------------------- */
/* Mode A — page ranges                                                        */
/* -------------------------------------------------------------------------- */

test('按页码范围：默认两段各 5 页，页序正确', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);
  await split(page);

  await expect(page.getByTestId('split-result')).toContainText('已拆分为 2 个文件');
  await expect(page.getByTestId('split-result-file')).toHaveCount(2);
  // The result list states which pages each file contains.
  await expect(page.getByTestId('split-result-pages')).toHaveText(['第 1–5 页', '第 6–10 页']);

  const first = await downloadNth(page, 0);
  expect(first.name).toBe('pages-10_001.pdf');
  const doc = await PDFDocument.load(readFileSync(first.path));
  expect(doc.getPageCount()).toBe(5);
  expect(await labelsOf(first.path)).toEqual(['T-1', 'T-2', 'T-3', 'T-4', 'T-5']);

  const second = await downloadNth(page, 1);
  expect(second.name).toBe('pages-10_002.pdf');
  expect(await labelsOf(second.path)).toEqual(['T-6', 'T-7', 'T-8', 'T-9', 'T-10']);
});

test('按页码范围：可以增删范围行', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);

  await page.getByTestId('split-add-range').click();
  await page.getByTestId('split-range-0').fill('1-2');
  await page.getByTestId('split-range-1').fill('3-4');
  await page.getByTestId('split-range-2').fill('5-10');

  await expect(page.getByTestId('split-plan-summary')).toHaveText('3 个文件 · 10 页');
  await split(page);

  await expect(page.getByTestId('split-result-file')).toHaveCount(3);
  const third = await downloadNth(page, 2);
  expect(await labelsOf(third.path)).toEqual([
    'T-5',
    'T-6',
    'T-7',
    'T-8',
    'T-9',
    'T-10',
  ]);
});

test('重叠范围会阻止拆分并指出冲突页码', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);

  // 1-5 and 4-10 both contain pages 4 and 5.
  await page.getByTestId('split-range-1').fill('4-10');
  await expect(page.getByTestId('split-plan-error')).toContainText('同时出现在多个范围中');
  await expect(page.getByTestId('split-plan-error')).toContainText('4、5');
  await expect(page.getByTestId('split-button')).toBeDisabled();
});

test('越界页码在行内提示，不触发拆分', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);

  await page.getByTestId('split-range-1').fill('8-99');
  await expect(page.getByText('页码 99 超出范围', { exact: false })).toBeVisible();
  await expect(page.getByTestId('split-button')).toBeDisabled();
});

/* -------------------------------------------------------------------------- */
/* Mode B — extract                                                            */
/* -------------------------------------------------------------------------- */

test('提取指定页面：点选同步输入，且保持点选顺序', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);
  await page.getByTestId('split-mode-extract').click();

  for (const pageNumber of [1, 3, 5, 8]) {
    await page.locator(`button[aria-label="选择第 ${pageNumber} 页"]`).click();
  }

  await expect(page.getByTestId('split-extract-input')).toHaveValue('1,3,5,8');
  await expect(page.getByTestId('split-plan-summary')).toHaveText('1 个文件 · 4 页');

  // Typing is authoritative too, and accepts a mixed expression.
  await page.getByTestId('split-extract-input').fill('9,1,2-3');
  await expect(page.getByTestId('split-plan-summary')).toHaveText('1 个文件 · 4 页');

  await split(page);
  await expect(page.getByTestId('split-result-file')).toHaveCount(1);

  const file = await downloadNth(page, 0);
  expect(file.name).toBe('pages-10_extract.pdf');
  // Order follows the input exactly: 9, then 1, then 2-3.
  expect(await labelsOf(file.path)).toEqual(['T-9', 'T-1', 'T-2', 'T-3']);
});

test('提取模式支持全选、反选与清空', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);
  await page.getByTestId('split-mode-extract').click();

  await page.getByRole('button', { name: '全选', exact: true }).click();
  await expect(page.getByTestId('split-plan-summary')).toHaveText('1 个文件 · 10 页');

  await page.getByRole('button', { name: '反选', exact: true }).click();
  await expect(page.getByTestId('split-button')).toBeDisabled();

  await page.getByTestId('split-extract-input').fill('1-3');
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect(page.getByTestId('split-extract-input')).toHaveValue('');
  await expect(page.getByTestId('split-button')).toBeDisabled();
});

/* -------------------------------------------------------------------------- */
/* Mode C — one file per page                                                  */
/* -------------------------------------------------------------------------- */

test('逐页拆分：10 个文件，编号从 001 连续', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);
  await page.getByTestId('split-mode-each').click();

  await expect(page.getByTestId('split-plan-summary')).toHaveText('10 个文件 · 10 页');
  await split(page);

  await expect(page.getByTestId('split-result-file')).toHaveCount(10);
  const names = await page
    .getByTestId('split-result-file')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-file-name')));
  expect(names).toEqual(
    Array.from({ length: 10 }, (_, index) => `pages-10_page_${String(index + 1).padStart(3, '0')}.pdf`),
  );

  // Each file holds exactly one page, in source order.
  for (const index of [0, 9]) {
    const file = await downloadNth(page, index);
    const doc = await PDFDocument.load(readFileSync(file.path));
    expect(doc.getPageCount()).toBe(1);
    expect(await labelsOf(file.path)).toEqual([`T-${index + 1}`]);
  }
});

/* -------------------------------------------------------------------------- */
/* Mode D — fixed pages per file                                               */
/* -------------------------------------------------------------------------- */

test('按固定页数：最后一组不足页数也照常生成', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);
  await page.getByTestId('split-mode-chunks').click();
  await page.getByTestId('split-chunk-size').fill('3');

  await expect(page.getByTestId('split-plan-summary')).toHaveText('4 个文件 · 10 页');
  await split(page);

  await expect(page.getByTestId('split-result-file')).toHaveCount(4);
  const last = await downloadNth(page, 3);
  expect(await labelsOf(last.path)).toEqual(['T-10']);
});

test('100 页文档按每份 25 页拆分', async ({ page }) => {
  await loadDocument(page, 'pages-100.pdf', 100);
  await page.getByTestId('split-mode-chunks').click();
  await page.getByTestId('split-chunk-size').fill('25');

  await expect(page.getByTestId('split-plan-summary')).toHaveText('4 个文件 · 100 页');
  await split(page);

  await expect(page.getByTestId('split-result-file')).toHaveCount(4);
  const fourth = await downloadNth(page, 3);
  const labels = await labelsOf(fourth.path);
  expect(labels).toHaveLength(25);
  expect(labels[0]).toBe('H-76');
  expect(labels[24]).toBe('H-100');
});

/* -------------------------------------------------------------------------- */
/* Download                                                                    */
/* -------------------------------------------------------------------------- */

test('ZIP 打包里是真实 PDF，而不是占位文件', async ({ page }) => {
  await loadDocument(page, 'pages-10.pdf', 10);
  await split(page);

  const pending = page.waitForEvent('download');
  await page.getByTestId('split-zip').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('pages-10_split.zip');

  const buffer = readFileSync((await download.path())!);
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files).sort();
  expect(entries).toEqual(['pages-10_001.pdf', 'pages-10_002.pdf']);

  // Unzip one entry and parse it: it must be a genuine 5-page PDF.
  const first = await zip.file('pages-10_001.pdf')!.async('uint8array');
  const doc = await PDFDocument.load(first);
  expect(doc.getPageCount()).toBe(5);
});

/* -------------------------------------------------------------------------- */
/* Cancelling                                                                  */
/* -------------------------------------------------------------------------- */

test('取消拆分不会产出结果', async ({ page }) => {
  // 300 single-page files: long enough that the cancel lands mid-task.
  await loadDocument(page, 'large-300.pdf', 300);
  await page.getByTestId('split-mode-each').click();
  await expect(page.getByTestId('split-plan-summary')).toHaveText('300 个文件 · 300 页');

  await page.getByTestId('split-button').scrollIntoViewIfNeeded();
  await page.getByTestId('split-button').click();
  await expect(page.getByTestId('split-progress')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('split-cancel').click();

  await expect(page.getByTestId('split-progress')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('split-result')).toHaveCount(0);
  await expect(page.getByTestId('split-error')).toHaveCount(0);
  await expect(page.getByTestId('split-button')).toBeEnabled();
});

/* -------------------------------------------------------------------------- */
/* Privacy + responsive                                                        */
/* -------------------------------------------------------------------------- */

test('拆分全程只有同源 GET 请求（无上传）', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    outbound.push(`${request.method()} ${url}`);
  });

  await openSplit(page);
  await page.waitForLoadState('networkidle');
  const baseline = outbound.length;
  const origin = new URL(page.url()).origin;

  await upload(page, 'pages-10.pdf');
  await expect(page.locator('[data-testid="split-page-grid"] img').first()).toBeVisible({
    timeout: 30_000,
  });
  await split(page);
  await page.waitForTimeout(300);

  const during = outbound.slice(baseline);
  expect(during.length).toBeGreaterThan(0);
  for (const entry of during) {
    const [method, url] = entry.split(' ');
    expect(method).toBe('GET');
    expect(new URL(url).origin).toBe(origin);
  }
});

test('手机尺寸（390×844）可完成拆分且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSplit(page);
  await upload(page, 'pages-10.pdf');
  await expect(page.getByTestId('split-document')).toContainText('10 页', { timeout: 30_000 });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const bar = page.getByTestId('split-button-mobile');
  await expect(bar).toBeVisible();
  await bar.click();

  await expect(page.getByTestId('split-result')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('split-result-file')).toHaveCount(2);
});

/* -------------------------------------------------------------------------- */
/* Screenshots                                                                 */
/* -------------------------------------------------------------------------- */

test('界面截图：空状态、工作区、提取模式、结果、深色与移动端', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '截图只需生成一次，固定使用 Chromium');

  await openSplit(page);
  await shot(page, '14-split-empty');

  await upload(page, 'pages-10.pdf');
  await expect(page.getByTestId('split-page-grid')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="split-page-grid"] img')).toHaveCount(10, {
    timeout: 30_000,
  });
  await page.waitForTimeout(900);
  await shot(page, '15-split-ranges');

  // Extract mode with a hand-picked, out-of-order selection.
  await page.getByTestId('split-mode-extract').click();
  for (const pageNumber of [1, 3, 5, 8]) {
    await page.locator(`button[aria-label="选择第 ${pageNumber} 页"]`).click();
  }
  await page.waitForTimeout(500);
  await shot(page, '16-split-extract');

  await split(page);
  await page.waitForTimeout(600);
  await shot(page, '17-split-result');

  // The generated file can be inspected with the shared preview dialog.
  await page.getByTestId('split-mode-ranges').click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '预览第 2 页' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(900);
  await shot(page, '18-split-preview');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: '切换到深色模式' }).click();
  await page.waitForTimeout(500);
  await shot(page, '19-split-dark');
  await page.getByRole('button', { name: '切换到浅色模式' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await shot(page, '20-split-mobile');
});
