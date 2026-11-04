/**
 * PDF engine.
 *
 * Runs inside a Web Worker (and inside Vitest, in Node) and deliberately has
 * **no DOM dependencies**. Everything here operates on in-memory bytes that
 * come from the user's own files: nothing is ever uploaded.
 *
 * The merge itself is a genuine page-level object copy through pdf-lib:
 * pages keep their original MediaBox, rotation, resources and vector content.
 * Pages are never rasterised, and PDF binaries are never concatenated as
 * bytes.
 */

import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  type PDFContext,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib';

import { MergeCancelledError, PdfEngineError } from './errors';
import type { PdfEngineErrorCode } from './errors';

export { MergeCancelledError, PdfEngineError };
export type { PdfEngineErrorCode };

/* -------------------------------------------------------------------------- */
/* Inspection                                                                  */
/* -------------------------------------------------------------------------- */

export interface PdfPageSize {
  width: number;
  height: number;
  rotation: number;
}

export interface PdfInspection {
  pageCount: number;
  /** Up to 60 page boxes, used to flag mixed paper sizes in the UI. */
  pageSizes: PdfPageSize[];
  hasForms: boolean;
  hasSignatures: boolean;
  hasOutlines: boolean;
  hasAnnotations: boolean;
}

function dictHasKey(dict: PDFDict | undefined, key: string): boolean {
  if (!dict) return false;
  return dict.get(PDFName.of(key)) !== undefined;
}

function resolveValue(ctx: PDFContext, value: PDFObject | undefined): PDFObject | undefined {
  if (!value) return undefined;
  const resolved = value instanceof PDFRef ? ctx.lookup(value) : value;
  return resolved ?? undefined;
}

/**
 * `PDFDict.lookup(key, Type)` throws when the key is missing, which happens all
 * the time in real documents. These helpers return `undefined` instead.
 */
function getDict(ctx: PDFContext, dict: PDFDict, key: string): PDFDict | undefined {
  const value = resolveValue(ctx, dict.get(PDFName.of(key)));
  return value instanceof PDFDict ? value : undefined;
}

function getArray(ctx: PDFContext, dict: PDFDict, key: string): PDFArray | undefined {
  const value = resolveValue(ctx, dict.get(PDFName.of(key)));
  return value instanceof PDFArray ? value : undefined;
}

function formFieldTypes(ctx: PDFContext, form: PDFDict | undefined): string[] {
  if (!form) return [];
  const fields = getArray(ctx, form, 'Fields');
  if (!fields) return [];

  const types: string[] = [];
  const visit = (object: PDFObject | undefined, depth: number) => {
    if (!object || depth > 4) return;
    const resolved = resolveValue(ctx, object);
    if (!(resolved instanceof PDFDict)) return;

    const fieldType = resolved.get(PDFName.of('FT'));
    if (fieldType) types.push(fieldType.toString().replace(/^\//, ''));

    const kids = getArray(ctx, resolved, 'Kids');
    if (kids) {
      for (let i = 0; i < kids.size(); i += 1) visit(kids.get(i), depth + 1);
    }
  };

  for (let i = 0; i < fields.size(); i += 1) visit(fields.get(i), 0);
  return types;
}

/**
 * Reads structural facts about a PDF without touching main-thread state.
 *
 * @throws {PdfEngineError} `encrypted` when the file is password protected,
 * `invalid-pdf` when pdf-lib cannot parse it.
 */
export async function inspectPdfBytes(bytes: Uint8Array): Promise<PdfInspection> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError || /encrypted/i.test(String(error))) {
      throw new PdfEngineError(
        'encrypted',
        '该 PDF 已加密（需要密码）。第一版不支持加密文件，请先用其它工具解除保护后再导入。',
        { cause: error },
      );
    }
    throw new PdfEngineError('invalid-pdf', '无法解析该 PDF，文件可能已损坏或不是标准 PDF。', {
      cause: error,
    });
  }

  return inspectDocument(doc);
}

/**
 * Structural inspection of an **already parsed** document.
 *
 * Exported for the rotation worker, which needs every page's `/Rotate` plus the
 * usual inspection facts from a single `PDFDocument.load()` instead of parsing
 * the same file twice. The body is the original `inspectPdfBytes` logic, so the
 * merge / split / image tools see exactly the same results as before.
 */
export function inspectDocument(doc: PDFDocument): PdfInspection {
  const pageCount = doc.getPageCount();
  if (pageCount === 0) {
    throw new PdfEngineError('empty-document', '该 PDF 不包含任何页面。');
  }

  const pageSizes: PdfPageSize[] = [];
  const pages = doc.getPages();
  const sampleCount = Math.min(pages.length, 60);
  for (let i = 0; i < sampleCount; i += 1) {
    const page: PDFPage = pages[i];
    const { width, height } = page.getSize();
    pageSizes.push({ width, height, rotation: page.getRotation().angle });
  }

  const catalog = doc.catalog;
  const acroForm = getDict(doc.context, catalog, 'AcroForm');
  const fieldTypes = formFieldTypes(doc.context, acroForm);
  const hasForms = !!acroForm && fieldTypes.length > 0;
  const hasSignatures = fieldTypes.some((type) => type === 'Sig');

  let hasAnnotations = false;
  for (const page of pages) {
    const annots = getArray(doc.context, page.node, 'Annots');
    if (annots && annots.size() > 0) {
      hasAnnotations = true;
      break;
    }
  }

  return {
    pageCount,
    pageSizes,
    hasForms,
    hasSignatures,
    hasOutlines: dictHasKey(catalog, 'Outlines'),
    hasAnnotations,
  };
}

/* -------------------------------------------------------------------------- */
/* Merge                                                                       */
/* -------------------------------------------------------------------------- */

export type MergeStage = 'loading' | 'copying' | 'saving' | 'verifying' | 'done';

export interface MergeProgress {
  stage: MergeStage;
  fileIndex: number;
  fileCount: number;
  fileName: string;
  pagesDone: number;
  pagesTotal: number;
}

export interface MergePlanFile {
  /** Display name, only used in messages and progress events. */
  name: string;
  /** Ordered, 0-based page indices. Repeats are allowed. */
  pages: number[];
}

export interface MergeHooks {
  /** Resolves the raw bytes for file `index`. Called once per file, in order. */
  getBytes: (index: number) => Promise<Uint8Array>;
  /** Written into the output document's metadata; wins over the source title. */
  title?: string;
  onProgress?: (progress: MergeProgress) => void;
  shouldCancel?: () => boolean;
}

export interface MergeOutcome {
  bytes: Uint8Array;
  pageCount: number;
  /** True when the produced file was re-parsed and matched the expected count. */
  verified: boolean;
}

const PAGES_PER_BATCH = 25;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isOutOfMemory(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /array buffer allocation failed|out of memory|allocation failed|Invalid array length/i.test(message);
}

export async function mergePdfPlans(
  plans: MergePlanFile[],
  hooks: MergeHooks,
): Promise<MergeOutcome> {
  if (plans.length === 0) {
    throw new PdfEngineError('empty-plan', '请至少添加一个 PDF 文件。');
  }

  const pagesTotal = plans.reduce((sum, plan) => sum + plan.pages.length, 0);
  if (pagesTotal === 0) {
    throw new PdfEngineError('empty-plan', '没有选中任何页面，无法合并。');
  }

  const throwIfCancelled = () => {
    if (hooks.shouldCancel?.()) throw new MergeCancelledError();
  };

  const emit = (
    stage: MergeStage,
    fileIndex: number,
    fileName: string,
    pagesDone: number,
  ): void => {
    hooks.onProgress?.({
      stage,
      fileIndex,
      fileCount: plans.length,
      fileName,
      pagesDone,
      pagesTotal,
    });
  };

  let pagesDone = 0;
  let produced: Uint8Array;
  let docTitle: string | undefined;
  let firstDocMeta: { author?: string; subject?: string; keywords?: string } = {};

  try {
    const out = await PDFDocument.create();

    for (let index = 0; index < plans.length; index += 1) {
      throwIfCancelled();
      const plan = plans[index];
      emit('loading', index, plan.name, pagesDone);

      if (!Array.isArray(plan.pages) || plan.pages.length === 0) {
        throw new PdfEngineError('empty-plan', `「${plan.name}」没有选中任何页面。`, {
          fileName: plan.name,
        });
      }

      let bytes: Uint8Array | null = await hooks.getBytes(index);
      if (!bytes || bytes.byteLength === 0) {
        throw new PdfEngineError('invalid-pdf', `「${plan.name}」的内容为空。`, {
          fileName: plan.name,
        });
      }

      let source: PDFDocument;
      try {
        source = await PDFDocument.load(bytes, { updateMetadata: false });
      } catch (error) {
        if (error instanceof EncryptedPDFError || /encrypted/i.test(String(error))) {
          throw new PdfEngineError(
            'encrypted',
            `「${plan.name}」已加密，第一版不支持合并加密 PDF。`,
            { fileName: plan.name, cause: error },
          );
        }
        throw new PdfEngineError('invalid-pdf', `「${plan.name}」无法解析，可能已损坏。`, {
          fileName: plan.name,
          cause: error,
        });
      }
      bytes = null;

      const sourcePages = source.getPageCount();
      if (sourcePages === 0) {
        throw new PdfEngineError('empty-document', `「${plan.name}」不包含任何页面。`, {
          fileName: plan.name,
        });
      }

      const invalidIndex = plan.pages.find((page) => page < 0 || page >= sourcePages);
      if (invalidIndex !== undefined) {
        throw new PdfEngineError(
          'page-out-of-range',
          `「${plan.name}」的页码 ${invalidIndex + 1} 超出范围（共 ${sourcePages} 页）。`,
          { fileName: plan.name },
        );
      }

      if (plans.length === 1) {
        docTitle = source.getTitle();
        firstDocMeta = {
          author: source.getAuthor(),
          subject: source.getSubject(),
          keywords: source.getKeywords(),
        };
      }

      // Copy in batches so cancellation and progress stay responsive.
      for (let offset = 0; offset < plan.pages.length; offset += PAGES_PER_BATCH) {
        throwIfCancelled();
        const batch = plan.pages.slice(offset, offset + PAGES_PER_BATCH);
        const copied = await out.copyPages(source, batch);
        for (const page of copied) out.addPage(page);
        pagesDone += batch.length;
        emit('copying', index, plan.name, pagesDone);
        await nextTick();
      }

      throwIfCancelled();
    }

    emit('saving', plans.length - 1, plans[plans.length - 1].name, pagesDone);
    await nextTick();

    const expectedPages = out.getPageCount();
    if (expectedPages !== pagesTotal) {
      throw new PdfEngineError(
        'unknown',
        `内部校验失败：预期 ${pagesTotal} 页，实际组装 ${expectedPages} 页。`,
      );
    }

    out.setProducer('PDFJoiner Web (pdf-lib)');
    out.setCreator('PDFJoiner Web');
    out.setCreationDate(new Date());
    const finalTitle = hooks.title?.trim() || docTitle;
    if (finalTitle) out.setTitle(finalTitle);
    if (firstDocMeta.author) out.setAuthor(firstDocMeta.author);
    if (firstDocMeta.subject) out.setSubject(firstDocMeta.subject);
    if (firstDocMeta.keywords) {
      const keywords = firstDocMeta.keywords
        .split(/[,;]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean);
      if (keywords.length > 0) out.setKeywords(keywords);
    }

    produced = await out.save({ useObjectStreams: true, addDefaultPage: false });
  } catch (error) {
    if (error instanceof MergeCancelledError || error instanceof PdfEngineError) throw error;
    if (isOutOfMemory(error)) {
      throw new PdfEngineError(
        'out-of-memory',
        '浏览器可用内存不足，无法完成合并。请减少文件数量、分批合并，或改用桌面端工具。',
        { cause: error },
      );
    }
    throw new PdfEngineError('unknown', '合并时发生未知错误，请重试或更换文件。', { cause: error });
  }

  // Re-parse small outputs to prove the produced file is valid. For very large
  // outputs this would double peak memory, so we skip it and report honestly.
  let verified = false;
  if (produced.byteLength <= 64 * 1024 * 1024) {
    emit('verifying', plans.length - 1, plans[plans.length - 1].name, pagesDone);
    try {
      const check = await PDFDocument.load(produced, { updateMetadata: false });
      if (check.getPageCount() !== pagesTotal) {
        throw new PdfEngineError(
          'verify-failed',
          `输出校验失败：预期 ${pagesTotal} 页，实际 ${check.getPageCount()} 页。`,
        );
      }
      verified = true;
    } catch (error) {
      if (error instanceof PdfEngineError) throw error;
      throw new PdfEngineError('verify-failed', '输出文件校验失败，已放弃本次合并结果。', {
        cause: error,
      });
    }
  }

  emit('done', plans.length - 1, plans[plans.length - 1].name, pagesDone);

  return { bytes: produced, pageCount: pagesTotal, verified };
}
