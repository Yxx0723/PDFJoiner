/**
 * End-to-end acceptance for the V1.3 PDF rotation tool.
 *
 * Downloads are opened again with pdf-lib and asserted at the `/Rotate` level;
 * nothing in this file trusts a UI badge alone.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { PDFName } from 'pdf-lib';

import { loadDoc, pageHasTextOperators, pageText } from '../unit/helpers/pdf';

const FIXTURES = join(process.cwd(), 'tests', 'fixtures');
const SCREENSHOTS = join(process.cwd(), 'docs', 'screenshots');
const fixture = (name: string) => join(FIXTURES, name);

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function openRotate(page: Page) {
  await page.goto('/#/rotate');
  await expect(page.getByRole('heading', { name: '把 PDF 页面转到正确方向' })).toBeVisible();
}

async function upload(page: Page, name: string, pageCount: number) {
  await openRotate(page);
  await page.locator('input[type=file]').first().setInputFiles(fixture(name));
  await expect(page.getByTestId('rotate-document')).toContainText(name);
  await expect(page.getByTestId('rotate-document')).toContainText(`${pageCount} 页`, {
    timeout: 45_000,
  });
  await expect(page.getByTestId('rotate-page-grid')).toBeVisible();
}

async function angles(page: Page): Promise<number[]> {
  return page
    .locator('[data-testid="rotate-page-card"]')
    .evaluateAll((cards) => cards.map((card) => Number(card.getAttribute('data-angle'))));
}

async function waitForThumbnails(page: Page, count: number) {
  await expect(page.locator('[data-testid="rotate-page-grid"] img')).toHaveCount(count, {
    timeout: 45_000,
  });
}

async function exportPdf(page: Page) {
  const button = page.getByTestId('rotate-button');
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page
      .getByTestId('rotate-progress')
      .or(page.getByTestId('rotate-result'))
      .or(page.getByTestId('rotate-error')),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('rotate-result')).toBeVisible({ timeout: 120_000 });
}

async function downloadResult(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByTestId('rotate-download').click();
  const download = await pending;
  const path = (await download.path())!;
  const bytes = new Uint8Array(readFileSync(path));
  return { name: download.suggestedFilename(), bytes, doc: await loadDoc(bytes) };
}

/**
 * Delays only the `rotate` job message so the cancel button can be clicked
 * deterministically on every browser. No product code is changed: the real
 * worker, protocol and client still run.
 */
async function delayRotateJob(page: Page, delay = 3000) {
  await page.evaluate((ms) => {
    const proto = Worker.prototype as unknown as {
      postMessage: (...args: unknown[]) => void;
    };
    const original = proto.postMessage;
    proto.postMessage = function patched(this: Worker, ...args: unknown[]) {
      const message = args[0] as { kind?: string } | undefined;
      if (message?.kind === 'rotate') {
        window.setTimeout(() => {
          try {
            original.apply(this, args);
          } catch {
            // The worker was terminated by cancel; nothing left to post to.
          }
        }, ms);
        return;
      }
      return original.apply(this, args);
    };
  }, delay);
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
/* Navigation + import                                                         */
/* -------------------------------------------------------------------------- */

test('顶部导航四个工具互通，旋转是独立页面', async ({ page }) => {
  await page.goto('/#/merge');
  for (const route of ['merge', 'images', 'split', 'rotate']) {
    await expect(page.getByTestId(`tool-nav-${route}`)).toBeVisible();
  }

  await page.getByTestId('tool-nav-rotate').click();
  await expect(page).toHaveURL(/#\/rotate$/);
  await expect(page.getByRole('heading', { name: '把 PDF 页面转到正确方向' })).toBeVisible();

  await page.getByTestId('tool-nav-split').click();
  await expect(page.getByRole('heading', { name: '把一份 PDF 拆成多份' })).toBeVisible();
  await page.getByTestId('tool-nav-rotate').click();
  await expect(page.getByTestId('tool-nav-rotate')).toHaveAttribute('aria-current', 'page');
});

test('载入 PDF 后显示页数、原生旋转与真实缩略图', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);

  await expect(page.getByTestId('rotate-document')).toContainText('3 页原本就带 /Rotate');
  await expect(page.getByTestId('rotate-summary')).toContainText('6 页');
  expect(await angles(page)).toEqual([0, 0, 90, 180, 270, 0]);
  await waitForThumbnails(page, 6);

  // Every thumbnail is a decoded bitmap, not a placeholder box.
  const sizes = await page
    .locator('[data-testid="rotate-page-grid"] img')
    .evaluateAll((images) =>
      images.map((image) => {
        const img = image as HTMLImageElement;
        return { width: img.naturalWidth, height: img.naturalHeight };
      }),
    );
  expect(sizes).toHaveLength(6);
  expect(sizes.every((size) => size.width > 20 && size.height > 20)).toBe(true);
  // Page 1 is portrait; page 2 has a landscape MediaBox.
  expect(sizes[0].width).toBeLessThan(sizes[0].height);
  expect(sizes[1].width).toBeGreaterThan(sizes[1].height);
});

test('缩略图按最终角度由 PDF.js 重新渲染，不是 CSS 旋转', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);
  await waitForThumbnails(page, 6);

  const box = async () =>
    page.locator('[data-testid="rotate-page-card"][data-page="1"] img').evaluate((image) => {
      const img = image as HTMLImageElement;
      return { width: img.naturalWidth, height: img.naturalHeight };
    });

  const before = await box();
  expect(before.width).toBeLessThan(before.height);

  await page.getByTestId('rotate-right-1').click();
  await expect(page.getByTestId('rotate-angle-1')).toHaveText('90°');
  await expect
    .poll(async () => {
      const size = await box();
      return size.width > size.height;
    }, { timeout: 30_000 })
    .toBe(true);

  const after = await box();
  // A CSS transform would leave naturalWidth/Height untouched.
  expect(after.width).toBeGreaterThan(after.height);
});

/* -------------------------------------------------------------------------- */
/* Rotation operations                                                         */
/* -------------------------------------------------------------------------- */

test('单页左右旋转、180° 与恢复原始方向', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);

  await page.getByTestId('rotate-right-1').click();
  expect((await angles(page))[0]).toBe(90);
  await page.getByTestId('rotate-left-1').click();
  expect((await angles(page))[0]).toBe(0);

  await page.getByTestId('rotate-more-1').click();
  await page.getByTestId('rotate-180-1').click();
  expect((await angles(page))[0]).toBe(180);

  await page.getByTestId('rotate-more-1').click();
  await page.getByTestId('rotate-reset-1').click();
  expect((await angles(page))[0]).toBe(0);

  // A page that was already rotated natively must keep that base angle.
  await page.getByTestId('rotate-right-3').click();
  expect((await angles(page))[2]).toBe(180);
  await page.getByTestId('rotate-more-3').click();
  await page.getByTestId('rotate-reset-3').click();
  expect((await angles(page))[2]).toBe(90);
});

test('选中页面批量旋转', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);

  await page.getByTestId('rotate-select-1').click();
  await page.getByTestId('rotate-select-4').click();
  await page.getByTestId('rotate-scope-selected').click();
  await expect(page.getByTestId('rotate-affected-count')).toHaveText('将影响 2 页');

  await page.getByTestId('rotate-batch-right').click();
  expect(await angles(page)).toEqual([90, 0, 90, 270, 270, 0]);
});

test('页码范围旋转（重复页码只转一次）', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);

  await page.getByTestId('rotate-scope-range').click();
  await page.getByTestId('rotate-range-input').fill('1-3,2');
  await expect(page.getByTestId('rotate-affected-count')).toHaveText('将影响 3 页');
  await page.getByTestId('rotate-batch-left').click();

  expect(await angles(page)).toEqual([270, 270, 0, 180, 270, 0]);
  await expect(page.getByTestId('rotate-range-error')).toHaveCount(0);
});

test('非法页码范围给出错误且不改变任何页面', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);

  await page.getByTestId('rotate-scope-range').click();
  await page.getByTestId('rotate-range-input').fill('1-99');
  await expect(page.getByTestId('rotate-range-error')).toContainText('超出范围');
  await expect(page.getByTestId('rotate-affected-count')).toHaveText('范围无效');
  await expect(page.getByTestId('rotate-batch-right')).toBeDisabled();
  expect(await angles(page)).toEqual([0, 0, 90, 180, 270, 0]);
});

test('全部页面旋转并明确显示影响页数', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);

  await page.getByTestId('rotate-scope-all').click();
  await expect(page.getByTestId('rotate-affected-count')).toHaveText('将影响 6 页');
  await page.getByTestId('rotate-batch-right').click();
  expect(await angles(page)).toEqual([90, 90, 180, 270, 0, 90]);

  await page.getByTestId('rotate-batch-180').click();
  expect(await angles(page)).toEqual([270, 270, 0, 90, 180, 270]);
});

test('撤销与重做', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);

  await page.getByTestId('rotate-right-1').click();
  await page.getByTestId('rotate-right-1').click();
  expect((await angles(page))[0]).toBe(180);

  await page.getByTestId('rotate-undo').click();
  expect((await angles(page))[0]).toBe(90);
  await page.getByTestId('rotate-undo').click();
  expect((await angles(page))[0]).toBe(0);
  await page.getByTestId('rotate-redo').click();
  expect((await angles(page))[0]).toBe(90);

  // A new edit clears the redo branch.
  await page.getByTestId('rotate-left-2').click();
  await expect(page.getByTestId('rotate-redo')).toBeDisabled();
});

test('重置全部恢复导入时的方向，而不是强制归零', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);

  await page.getByTestId('rotate-scope-all').click();
  await page.getByTestId('rotate-batch-right').click();
  await page.getByTestId('rotate-reset-all').click();
  expect(await angles(page)).toEqual([0, 0, 90, 180, 270, 0]);
});

/* -------------------------------------------------------------------------- */
/* Export                                                                      */
/* -------------------------------------------------------------------------- */

test('导出并下载：角度正确、页面可重开、内容与尺寸保留、原文件不变', async ({ page }) => {
  const sourceBefore = new Uint8Array(readFileSync(fixture('rotate-mixed.pdf')));

  await upload(page, 'rotate-mixed.pdf', 6);
  await page.getByTestId('rotate-right-1').click();
  await page.getByTestId('rotate-scope-range').click();
  await page.getByTestId('rotate-range-input').fill('3-4');
  await page.getByTestId('rotate-batch-left').click();
  expect(await angles(page)).toEqual([90, 0, 0, 90, 270, 0]);

  await expect(page.getByTestId('rotate-output-name')).toHaveText('rotate-mixed_rotated.pdf');
  await exportPdf(page);
  await expect(page.getByTestId('rotate-result')).toContainText('已重新解析并逐页核对');

  const { name, bytes, doc } = await downloadResult(page);
  expect(name).toBe('rotate-mixed_rotated.pdf');
  expect(bytes.byteLength).toBeGreaterThan(1000);

  const source = await loadDoc(sourceBefore);
  const pages = doc.getPages();
  expect(pages).toHaveLength(6);
  expect(pages.map((item) => item.getRotation().angle)).toEqual([90, 0, 0, 90, 270, 0]);
  expect(source.getPages().map((item) => item.getRotation().angle)).toEqual([0, 0, 90, 180, 270, 0]);
  expect(Buffer.from(bytes).equals(Buffer.from(sourceBefore))).toBe(false);

  // Page order, text operators and MediaBox all survive.
  const labels = pages.map((item) => pageText(item, doc).trim().split('\n')[0]);
  expect(labels).toEqual(['ROT-1', 'ROT-2', 'ROT-3', 'ROT-4', 'ROT-5', 'ROT-6']);
  expect(pages.every((item) => pageHasTextOperators(item, doc))).toBe(true);
  expect(pages[1].getSize()).toEqual(source.getPages()[1].getSize());
});

test('含书签与注释的 PDF 可以旋转并保留结构', async ({ page }) => {
  await upload(page, 'outlined-annotated.pdf', 3);
  await page.getByTestId('rotate-right-1').click();
  await exportPdf(page);

  const { doc } = await downloadResult(page);
  expect(doc.getPages()).toHaveLength(3);
  expect(doc.catalog.get(PDFName.of('Outlines'))).toBeDefined();
  expect(doc.getPages()[0].node.get(PDFName.of('Annots'))).toBeDefined();
  expect(doc.getPages()[0].getRotation().angle).toBe(90);
});

test('取消导出不会产生可下载的半成品文件', async ({ page }) => {
  await upload(page, 'rotate-large.pdf', 600);
  await delayRotateJob(page);

  await page.getByTestId('rotate-button').scrollIntoViewIfNeeded();
  await page.getByTestId('rotate-button').click();
  await expect(page.getByTestId('rotate-progress')).toBeVisible();

  await page.getByTestId('rotate-cancel').click();
  await expect(page.getByTestId('rotate-cancelled')).toBeVisible();
  await expect(page.getByTestId('rotate-result')).toHaveCount(0);
  await expect(page.getByTestId('rotate-download')).toHaveCount(0);
  await expect(page.getByTestId('rotate-button')).toBeEnabled();
});

test('600 页文档分批挂载，缩略图按需渲染', async ({ page }) => {
  await upload(page, 'rotate-large.pdf', 600);

  await expect(page.locator('[data-testid="rotate-page-card"]')).toHaveCount(60);
  await expect(page.getByTestId('rotate-show-more')).toContainText('剩余 540 页');

  const renderedBefore = await page.locator('[data-testid="rotate-page-grid"] img').count();
  expect(renderedBefore).toBeLessThanOrEqual(60);

  await page.getByTestId('rotate-show-more').click();
  await expect(page.locator('[data-testid="rotate-page-card"]')).toHaveCount(120);
});

/* -------------------------------------------------------------------------- */
/* Preview dialog                                                              */
/* -------------------------------------------------------------------------- */

test('大图预览按最终方向渲染，支持旋转、缩放、翻页与状态保留', async ({ page }) => {
  await upload(page, 'rotate-mixed.pdf', 6);
  await waitForThumbnails(page, 6);

  await page.getByTestId('rotate-preview-1').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('preview-rotation-angle')).toHaveText('当前 0°');
  await expect(page.getByRole('dialog').locator('img').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('zoom-level')).toBeVisible();

  await page.getByTestId('preview-rotate-right').click();
  await expect(page.getByTestId('preview-rotation-angle')).toHaveText('当前 90°');
  await expect
    .poll(
      async () =>
        page.getByRole('dialog').locator('img').first().evaluate((image) => {
          const img = image as HTMLImageElement;
          return img.naturalWidth > img.naturalHeight;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);

  // Zoom still works after a rotation.
  await page.getByRole('button', { name: '实际大小' }).click();
  await expect(page.getByTestId('zoom-level')).toHaveText('100%');

  await page.getByTestId('preview-rotate-reset').click();
  await expect(page.getByTestId('preview-rotation-angle')).toHaveText('当前 0°');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await angles(page))[0]).toBe(0);
});

/* -------------------------------------------------------------------------- */
/* Failures, privacy, responsive                                               */
/* -------------------------------------------------------------------------- */

test('加密、损坏、伪装 PDF 与多文件都有明确反馈', async ({ page }) => {
  await openRotate(page);

  await page.locator('input[type=file]').first().setInputFiles(fixture('encrypted.pdf'));
  await expect(page.getByTestId('rotate-document')).toContainText('加密');
  await expect(page.getByTestId('rotate-page-grid')).toHaveCount(0);

  await page.locator('input[type=file]').first().setInputFiles(fixture('broken.pdf'));
  await expect(page.getByTestId('rotate-document')).toContainText('无法解析');

  await page.locator('input[type=file]').first().setInputFiles(fixture('not-a-pdf.pdf'));
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '不是 PDF' }).first(),
  ).toBeVisible();
});

test('旋转全程只有同源 GET 请求（无上传）', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    outbound.push(`${request.method()} ${url}`);
  });

  await openRotate(page);
  await page.waitForLoadState('networkidle');
  const baseline = outbound.length;
  const origin = new URL(page.url()).origin;

  await page.locator('input[type=file]').first().setInputFiles(fixture('rotate-mixed.pdf'));
  await expect(page.getByTestId('rotate-page-grid')).toBeVisible({ timeout: 45_000 });
  await waitForThumbnails(page, 6);
  await page.getByTestId('rotate-right-1').click();
  await exportPdf(page);
  await page.waitForTimeout(300);

  const during = outbound.slice(baseline);
  expect(during.length).toBeGreaterThan(0);
  for (const entry of during) {
    expect(entry).toMatch(/^GET /);
    expect(entry.startsWith(`GET ${origin}`)).toBe(true);
  }
});

test('移动端无横向溢出，底部导出栏可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await upload(page, 'rotate-mixed.pdf', 6);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('rotate-button-mobile')).toBeVisible();
  await expect(page.getByTestId('rotate-page-grid')).toBeVisible();
});

/* -------------------------------------------------------------------------- */
/* Screenshots                                                                 */
/* -------------------------------------------------------------------------- */

test('界面截图：空状态、工作区、单页旋转、范围、预览、结果、深色与移动端', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '截图只需生成一次，固定使用 Chromium');

  await openRotate(page);
  await shot(page, '21-rotate-empty');

  await page.locator('input[type=file]').first().setInputFiles(fixture('rotate-mixed.pdf'));
  await expect(page.getByTestId('rotate-page-grid')).toBeVisible({ timeout: 45_000 });
  await waitForThumbnails(page, 6);
  await page.waitForTimeout(600);
  await shot(page, '22-rotate-workspace');

  await page.getByTestId('rotate-right-1').click();
  await page.getByTestId('rotate-left-3').click();
  await page.waitForTimeout(700);
  await shot(page, '23-rotate-single');

  await page.getByTestId('rotate-scope-range').click();
  await page.getByTestId('rotate-range-input').fill('2-5');
  await page.waitForTimeout(400);
  await shot(page, '24-rotate-range');

  await page.getByTestId('rotate-preview-2').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(900);
  await shot(page, '25-rotate-preview');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await exportPdf(page);
  await page.waitForTimeout(500);
  await shot(page, '26-rotate-result');

  await page.getByRole('button', { name: '切换到深色模式' }).click();
  await page.waitForTimeout(500);
  await shot(page, '27-rotate-dark');
  await page.getByRole('button', { name: '切换到浅色模式' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  await shot(page, '28-rotate-mobile');
});
