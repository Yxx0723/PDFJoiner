/**
 * PDF rotation engine (V1.3).
 *
 * Runs inside a Web Worker, and inside Vitest in Node: **no DOM access**.
 *
 * Design notes
 *  - Rotation is written to the page dictionary's `/Rotate` entry via
 *    `PDFPage.setRotation()`. No page is ever rasterised, no content stream is
 *    rewritten, and MediaBox / Resources / annotations travel untouched.
 *  - The caller sends **final absolute angles**. This module never adds a delta
 *    to the source rotation itself, which would double-apply it.
 *  - Only pages whose angle actually changes are written. Untouched pages keep
 *    their original bytes as far as pdf-lib's serializer allows.
 *  - Cancellation is checked between page batches and immediately before/after
 *    `save()`. The client additionally terminates the worker, because pdf-lib's
 *    synchronous save cannot observe a posted message.
 *  - Small outputs are re-parsed and every page's angle, box and content-stream
 *    presence is compared with the source before the result is returned.
 */

import { EncryptedPDFError, PDFDocument, PDFName, degrees, type PDFPage } from 'pdf-lib';

import { inspectDocument } from '@/features/pdf/engine';
import { MergeCancelledError, PdfEngineError } from '@/features/pdf/errors';
import { isRotationAngle, normalizeAngle, toRotationAngle } from './rotation';
import type {
  RotateInspection,
  RotateOutcome,
  RotateProgress,
  RotateStage,
  RotationAngle,
  RotationJob,
} from './types';

export { MergeCancelledError, PdfEngineError };

const PAGES_PER_BATCH = 25;
const DEFAULT_VERIFY_LIMIT = 64 * 1024 * 1024;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isOutOfMemory(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /array buffer allocation failed|out of memory|allocation failed|Invalid array length/i.test(
    message,
  );
}

async function loadSource(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError || /encrypted/i.test(String(error))) {
      throw new PdfEngineError(
        'encrypted',
        '该 PDF 已加密（需要密码）。第一版不支持加密文件，请先解除保护后再旋转。',
        { cause: error },
      );
    }
    throw new PdfEngineError('invalid-pdf', '无法解析该 PDF，文件可能已损坏或不是标准 PDF。', {
      cause: error,
    });
  }
  if (doc.getPageCount() === 0) {
    throw new PdfEngineError('empty-document', '该 PDF 不包含任何页面。');
  }
  return doc;
}

/**
 * Reads `/Rotate` for **every** page (the shared inspector samples only the
 * first 60). A non-multiple-of-90 angle is refused rather than silently
 * rounded, because the PDF spec allows only quarter turns here.
 */
export function readPageRotations(doc: PDFDocument): RotationAngle[] {
  return doc.getPages().map((page, index) => {
    const normalized = normalizeAngle(page.getRotation().angle);
    if (!isRotationAngle(normalized)) {
      throw new PdfEngineError(
        'invalid-pdf',
        `第 ${index + 1} 页的原始旋转角度为 ${normalized}°，不是 90° 的倍数，无法安全处理。`,
      );
    }
    return normalized;
  });
}

/** One parse for page count, all rotations, and the usual inspection facts. */
export async function inspectForRotation(bytes: Uint8Array): Promise<RotateInspection> {
  const doc = await loadSource(bytes);
  return {
    pageCount: doc.getPageCount(),
    rotations: readPageRotations(doc),
    inspection: inspectDocument(doc),
  };
}

export interface RotateHooks {
  onProgress?: (progress: RotateProgress) => void;
  shouldCancel?: () => boolean;
  /** Re-parse outputs below this size. Defaults to 64 MB. */
  verifyBelowBytes?: number;
}

/**
 * Applies final rotations and returns a new PDF. The input bytes are never
 * mutated, and the caller's `File` is never touched.
 *
 * @throws {PdfEngineError} `encrypted` / `invalid-pdf` / `empty-document` /
 * `page-out-of-range` / `verify-failed` / `out-of-memory`,
 * or {MergeCancelledError} when cancelled.
 */
export async function rotatePdf(
  bytes: Uint8Array,
  jobs: RotationJob[],
  hooks: RotateHooks = {},
): Promise<RotateOutcome> {
  const throwIfCancelled = () => {
    if (hooks.shouldCancel?.()) throw new MergeCancelledError('旋转已取消。');
  };

  const emit = (stage: RotateStage, current: number, total: number): void => {
    hooks.onProgress?.({ stage, current, total });
  };

  try {
    emit('loading', 0, 0);
    const doc = await loadSource(bytes);
    const pages = doc.getPages();
    const count = pages.length;
    const originals = readPageRotations(doc);

    // Validate the whole plan before writing a single page.
    if (!Array.isArray(jobs)) {
      throw new PdfEngineError('empty-plan', '没有可用的旋转任务。');
    }
    const byPage = new Map<number, RotationAngle>();
    for (const job of jobs) {
      if (!Number.isInteger(job.pageIndex) || job.pageIndex < 0 || job.pageIndex >= count) {
        throw new PdfEngineError(
          'page-out-of-range',
          `旋转任务引用了第 ${job.pageIndex + 1} 页，超出范围（共 ${count} 页）。`,
        );
      }
      let angle: RotationAngle;
      try {
        angle = toRotationAngle(job.finalAngle);
      } catch (error) {
        throw new PdfEngineError(
          'invalid-pdf',
          `第 ${job.pageIndex + 1} 页的目标角度不合法：${String(job.finalAngle)}。${error instanceof Error ? error.message : ''}`,
        );
      }
      // A repeated index must not be applied twice; the last value wins.
      byPage.set(job.pageIndex, angle);
    }
    const expected: RotationAngle[] = originals.map((angle, index) => byPage.get(index) ?? angle);

    const boxes = pages.map((page) => page.getSize());
    const hasContent = pages.map((page) => page.node.get(PDFName.of('Contents')) !== undefined);

    emit('applying', 0, count);
    const changes: Array<{ page: PDFPage; angle: RotationAngle }> = [];
    for (let index = 0; index < count; index += 1) {
      if (index % PAGES_PER_BATCH === 0) {
        throwIfCancelled();
        await nextTick();
      }
      if (expected[index] !== originals[index]) {
        changes.push({ page: pages[index], angle: expected[index] });
      }
      emit('applying', index + 1, count);
    }
    for (const change of changes) change.page.setRotation(degrees(change.angle));
    throwIfCancelled();

    emit('saving', count, count);
    await nextTick();
    const produced = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    throwIfCancelled();

    let verified = false;
    if (produced.byteLength <= (hooks.verifyBelowBytes ?? DEFAULT_VERIFY_LIMIT)) {
      emit('verifying', count, count);
      try {
        const check = await PDFDocument.load(produced, { updateMetadata: false });
        if (check.getPageCount() !== count) {
          throw new PdfEngineError(
            'verify-failed',
            `输出校验失败：预期 ${count} 页，实际 ${check.getPageCount()} 页。`,
          );
        }
        const checked = check.getPages();
        for (let index = 0; index < count; index += 1) {
          const angle = normalizeAngle(checked[index].getRotation().angle);
          if (angle !== expected[index]) {
            throw new PdfEngineError(
              'verify-failed',
              `输出校验失败：第 ${index + 1} 页应为 ${expected[index]}°，实际 ${angle}°。`,
            );
          }
          const size = checked[index].getSize();
          if (Math.abs(size.width - boxes[index].width) > 0.01 ||
              Math.abs(size.height - boxes[index].height) > 0.01) {
            throw new PdfEngineError(
              'verify-failed',
              `输出校验失败：第 ${index + 1} 页的 MediaBox 尺寸发生了变化。`,
            );
          }
          if (hasContent[index] && checked[index].node.get(PDFName.of('Contents')) === undefined) {
            throw new PdfEngineError(
              'verify-failed',
              `输出校验失败：第 ${index + 1} 页的内容流丢失。`,
            );
          }
        }
        verified = true;
      } catch (error) {
        if (error instanceof PdfEngineError) throw error;
        throw new PdfEngineError('verify-failed', '输出文件重新解析失败，已放弃本次结果。', {
          cause: error,
        });
      }
    }

    emit('done', count, count);
    return { bytes: produced, pageCount: count, rotations: expected, verified };
  } catch (error) {
    if (error instanceof MergeCancelledError || error instanceof PdfEngineError) throw error;
    if (isOutOfMemory(error)) {
      throw new PdfEngineError(
        'out-of-memory',
        '浏览器可用内存不足，无法完成旋转。请尝试更小的文件，或关闭其它标签页后重试。',
        { cause: error },
      );
    }
    throw new PdfEngineError('unknown', '旋转时发生未知错误，请重试或更换文件。', { cause: error });
  }
}
