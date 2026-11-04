/**
 * Split engine.
 *
 * Runs inside a Web Worker (and inside Vitest, in Node): **no DOM access**.
 *
 * Design notes
 *  - The source document is parsed **once** for the whole task, so splitting a
 *    300-page file into 300 pieces does not mean 300 parses.
 *  - Each output is a real pdf-lib document whose pages are copied as page
 *    objects (`copyPages`). Nothing is rasterised, no binary is sliced, and the
 *    original MediaBox / rotation / resources travel with the page.
 *  - Pages are copied in batches with a `setTimeout(0)` between them so a
 *    cancellation request can be observed while a large file is being worked on.
 *  - Every output is re-parsed when it is small enough; a page-count mismatch
 *    aborts the whole task instead of returning a wrong file.
 */

import { EncryptedPDFError, PDFDocument } from 'pdf-lib';

import { MergeCancelledError, PdfEngineError } from '@/features/pdf/errors';

export { MergeCancelledError, PdfEngineError };

export type SplitStage = 'loading' | 'copying' | 'saving' | 'verifying' | 'done';

export interface SplitProgress {
  stage: SplitStage;
  /** 0-based index of the file being produced. */
  outputIndex: number;
  outputCount: number;
  outputName: string;
  pagesDone: number;
  pagesTotal: number;
}

export interface SplitJob {
  /** Output file name, including `.pdf`. */
  name: string;
  /** Ordered, 0-based page indices. */
  pages: number[];
}

export interface SplitFileResult {
  name: string;
  pages: number[];
  pageCount: number;
  bytes: Uint8Array;
}

export interface SplitOutcome {
  files: SplitFileResult[];
  /** True when every output was re-parsed and matched its expected page count. */
  verified: boolean;
}

export interface SplitHooks {
  onProgress?: (progress: SplitProgress) => void;
  shouldCancel?: () => boolean;
  /** Re-parse outputs below this size. Defaults to 64 MB. */
  verifyBelowBytes?: number;
}

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

/**
 * Splits one PDF into the given jobs.
 *
 * @throws {PdfEngineError} `encrypted` / `invalid-pdf` / `page-out-of-range` /
 * `verify-failed` / `out-of-memory`, or {MergeCancelledError} when cancelled.
 */
export async function splitPdf(
  bytes: Uint8Array,
  jobs: SplitJob[],
  hooks: SplitHooks = {},
): Promise<SplitOutcome> {
  if (jobs.length === 0) {
    throw new PdfEngineError('empty-plan', '没有需要生成的文件。');
  }

  const pagesTotal = jobs.reduce((sum, job) => sum + job.pages.length, 0);
  if (pagesTotal === 0) {
    throw new PdfEngineError('empty-plan', '没有任何页面需要输出。');
  }

  const throwIfCancelled = () => {
    if (hooks.shouldCancel?.()) throw new MergeCancelledError('拆分已取消。');
  };

  const emit = (
    stage: SplitStage,
    outputIndex: number,
    outputName: string,
    pagesDone: number,
  ): void => {
    hooks.onProgress?.({
      stage,
      outputIndex,
      outputCount: jobs.length,
      outputName,
      pagesDone,
      pagesTotal,
    });
  };

  const verifyLimit = hooks.verifyBelowBytes ?? DEFAULT_VERIFY_LIMIT;
  const files: SplitFileResult[] = [];
  let verified = true;
  let pagesDone = 0;

  try {
    emit('loading', 0, jobs[0]?.name ?? '', 0);

    let source: PDFDocument;
    try {
      source = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      if (error instanceof EncryptedPDFError || /encrypted/i.test(String(error))) {
        throw new PdfEngineError(
          'encrypted',
          '该 PDF 已加密（需要密码）。第一版不支持加密文件，请先解除保护后再拆分。',
          { cause: error },
        );
      }
      throw new PdfEngineError('invalid-pdf', '无法解析该 PDF，文件可能已损坏或不是标准 PDF。', {
        cause: error,
      });
    }

    const sourcePages = source.getPageCount();
    if (sourcePages === 0) {
      throw new PdfEngineError('empty-document', '该 PDF 不包含任何页面。');
    }

    // Fail before writing anything if a job is malformed.
    for (const job of jobs) {
      if (job.pages.length === 0) {
        throw new PdfEngineError('empty-plan', `「${job.name}」没有包含任何页面。`);
      }
      const invalid = job.pages.find(
        (page) => !Number.isInteger(page) || page < 0 || page >= sourcePages,
      );
      if (invalid !== undefined) {
        throw new PdfEngineError(
          'page-out-of-range',
          `「${job.name}」引用了第 ${invalid + 1} 页，超出范围（共 ${sourcePages} 页）。`,
        );
      }
    }

    const author = source.getAuthor();
    const subject = source.getSubject();
    const keywords = source.getKeywords();

    for (let index = 0; index < jobs.length; index += 1) {
      throwIfCancelled();
      const job = jobs[index];

      const out = await PDFDocument.create();
      out.setProducer('PDFJoiner Web (pdf-lib)');
      out.setCreator('PDFJoiner Web');
      out.setCreationDate(new Date());
      out.setTitle(job.name.replace(/\.pdf$/i, ''));
      if (author) out.setAuthor(author);
      if (subject) out.setSubject(subject);
      if (keywords) {
        const list = keywords
          .split(/[,;]/)
          .map((keyword) => keyword.trim())
          .filter(Boolean);
        if (list.length > 0) out.setKeywords(list);
      }

      emit('copying', index, job.name, pagesDone);

      for (let offset = 0; offset < job.pages.length; offset += PAGES_PER_BATCH) {
        throwIfCancelled();
        const batch = job.pages.slice(offset, offset + PAGES_PER_BATCH);
        const copied = await out.copyPages(source, batch);
        for (const page of copied) out.addPage(page);
        pagesDone += batch.length;
        emit('copying', index, job.name, pagesDone);
        await nextTick();
      }

      // Cheap internal invariant: catches a bad copy list before we serialise.
      if (out.getPageCount() !== job.pages.length) {
        throw new PdfEngineError(
          'unknown',
          `内部校验失败：「${job.name}」预期 ${job.pages.length} 页，实际组装 ${out.getPageCount()} 页。`,
        );
      }

      emit('saving', index, job.name, pagesDone);
      await nextTick();
      const produced = await out.save({ useObjectStreams: true, addDefaultPage: false });

      if (produced.byteLength <= verifyLimit) {
        emit('verifying', index, job.name, pagesDone);
        try {
          const check = await PDFDocument.load(produced, { updateMetadata: false });
          if (check.getPageCount() !== job.pages.length) {
            throw new PdfEngineError(
              'verify-failed',
              `输出校验失败：「${job.name}」预期 ${job.pages.length} 页，实际 ${check.getPageCount()} 页。`,
            );
          }
        } catch (error) {
          if (error instanceof PdfEngineError) throw error;
          throw new PdfEngineError('verify-failed', `输出文件「${job.name}」校验失败，已放弃本次结果。`, {
            cause: error,
          });
        }
      } else {
        // Honest reporting: we could not afford to re-read this one.
        verified = false;
      }

      files.push({
        name: job.name,
        pages: job.pages,
        pageCount: job.pages.length,
        bytes: produced,
      });
    }

    emit('done', jobs.length - 1, jobs[jobs.length - 1].name, pagesDone);
  } catch (error) {
    if (error instanceof MergeCancelledError || error instanceof PdfEngineError) throw error;
    if (isOutOfMemory(error)) {
      throw new PdfEngineError(
        'out-of-memory',
        '浏览器可用内存不足，无法完成拆分。请减少输出份数（例如改用「按固定页数」并增大每份页数），或更换文件后重试。',
        { cause: error },
      );
    }
    throw new PdfEngineError('unknown', '拆分时发生未知错误，请重试或更换文件。', { cause: error });
  }

  return { files, verified };
}
