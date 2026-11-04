import type { PdfFileEntry } from '@/store/use-app-store';
import { selectedPageCount } from '@/store/use-app-store';
import { formatAsRange } from '@/features/page-range/parse-page-range';

export interface TaskSummary {
  fileCount: number;
  readyCount: number;
  errorCount: number;
  readingCount: number;
  outputPages: number;
  inputBytes: number;
}

export function summarize(files: PdfFileEntry[]): TaskSummary {
  let outputPages = 0;
  let inputBytes = 0;
  let readyCount = 0;
  let errorCount = 0;
  let readingCount = 0;

  for (const entry of files) {
    inputBytes += entry.size;
    if (entry.status === 'ready') {
      readyCount += 1;
      outputPages += selectedPageCount(entry);
    } else if (entry.status === 'error') {
      errorCount += 1;
    } else {
      readingCount += 1;
    }
  }

  return {
    fileCount: files.length,
    readyCount,
    errorCount,
    readingCount,
    outputPages,
    inputBytes,
  };
}

/** Value shown in the per-file page range input. */
export function selectionInputValue(entry: PdfFileEntry): string {
  if (entry.selection.draft !== null) return entry.selection.draft;
  const pages = entry.selection.pages;
  if (!pages) return '';
  return formatAsRange(pages) ?? pages.map((page) => page + 1).join(',');
}

/** Ordered 0-based indices actually used for this file. */
export function effectivePages(entry: PdfFileEntry): number[] {
  if (entry.status !== 'ready') return [];
  return entry.selection.pages ?? Array.from({ length: entry.pageCount }, (_, index) => index);
}

/** Empty array means "ready to merge". */
export function getMergeBlockers(files: PdfFileEntry[], busy: boolean): string[] {
  if (busy) return ['正在合并，请稍候…'];
  if (files.length === 0) return ['先添加至少一个 PDF 文件'];

  const reading = files.filter((entry) => entry.status === 'reading').length;
  if (reading > 0) return [`正在读取 ${reading} 个文件，请稍候`];

  const failed = files.filter((entry) => entry.status === 'error');
  if (failed.length > 0) {
    return [`有 ${failed.length} 个文件无法处理，请移除后再合并`];
  }

  const invalidRange = files.find((entry) => entry.selection.error);
  if (invalidRange) return [`「${invalidRange.name}」的页码范围需要修正`];

  const empty = files.find((entry) => selectedPageCount(entry) === 0);
  if (empty) return [`「${empty.name}」没有选中任何页面`];

  if (files.reduce((sum, entry) => sum + selectedPageCount(entry), 0) === 0) {
    return ['合并结果会是 0 页'];
  }

  return [];
}

/** Human readable description of document-level features that will be dropped. */
export function describeCaveats(entry: PdfFileEntry): string[] {
  const notes: string[] = [];
  const inspection = entry.inspection;
  if (!inspection) return notes;

  if (inspection.hasSignatures) notes.push('含数字签名：合并后原签名不再有效');
  if (inspection.hasForms) notes.push('含交互表单：合并后表单字段不保留');
  if (inspection.hasOutlines) notes.push('含书签：合并后文档书签不保留');

  const sizes = inspection.pageSizes;
  if (sizes.length > 1) {
    const first = sizes[0];
    const mixed = sizes.some(
      (size) =>
        Math.abs(size.width - first.width) > 1 ||
        Math.abs(size.height - first.height) > 1 ||
        size.rotation !== first.rotation,
    );
    if (mixed) notes.push('含不同纸张尺寸或方向：将按原始尺寸保留');
  }

  return notes;
}
