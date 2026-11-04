/**
 * Split planning.
 *
 * A pure function that turns "one PDF + a mode + some settings" into the exact
 * list of files that will be produced. Nothing here touches pdf-lib: the UI
 * uses the plan to draw chips and counts, the worker uses it as the copy list,
 * and the unit tests use it directly. Keeping one planner means the preview
 * count can never disagree with the number of files actually written.
 *
 * Page numbers follow the same convention as the merge tool: user-facing page
 * numbers are 1-based, the planner emits **0-based** indices.
 */

import { LIMITS } from '@/lib/constants';
import {
  PageRangeError,
  normalizeRangeInput,
  parsePageRange,
} from '@/features/page-range/parse-page-range';
import { sanitizeFileName } from '@/lib/utils';
import type { SplitMode, SplitPlan, SplitPlanOutput, SplitSettings } from './types';

/* -------------------------------------------------------------------------- */
/* Formatting helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Groups 1-based page numbers into inclusive runs: `[1,2,3,7] → [[1,3],[7,7]]`. */
function runs(pageNumbers: readonly number[]): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (const page of pageNumbers) {
    const last = result[result.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else result.push([page, page]);
  }
  return result;
}

/** ASCII-only compact form, safe inside a file name: `1-5`, `1,3,5,8-12`. */
export function compactRanges(pageNumbers: readonly number[]): string {
  return runs(pageNumbers)
    .map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`))
    .join(',');
}

/** Human label using en dashes: `第 1–5 页`, `第 1、3、7–9 页`. */
export function describePages(pageNumbers: readonly number[]): string {
  if (pageNumbers.length === 0) return '无页面';
  if (pageNumbers.length === 1) return `第 ${pageNumbers[0]} 页`;

  const groups = runs(pageNumbers);
  const parts = groups
    .slice(0, 4)
    .map(([start, end]) => (start === end ? `${start}` : `${start}–${end}`));
  const suffix = groups.length > 4 ? '…' : '';
  return `第 ${parts.join('、')}${suffix} 页`;
}

/** Zero-padding width for output numbering: at least 3 digits. */
export function padWidth(count: number): number {
  return Math.max(3, String(Math.max(count, 1)).length);
}

/** Strips anything the download API would object to and drops a trailing `.pdf`. */
export function resolvePrefix(raw: string): string {
  const cleaned = sanitizeFileName(raw || 'split', 'split')
    .replace(/\.pdf$/i, '')
    .trim();
  return cleaned || 'split';
}

/** Default file-name stem for a mode, derived from the source file name. */
export function autoPrefix(mode: SplitMode, sourceName: string): string {
  const base =
    (sourceName || 'document')
      .replace(/\.pdf$/i, '')
      .trim()
      .slice(0, 80) || 'document';
  if (mode === 'extract') return `${base}_extract`;
  if (mode === 'each') return `${base}_page`;
  return base;
}

/* -------------------------------------------------------------------------- */
/* Planner                                                                     */
/* -------------------------------------------------------------------------- */

function emptyPlan(errors: string[], notes: string[] = []): SplitPlan {
  return { outputs: [], errors, notes, rowErrors: {} };
}

function makeOutput(index: number, pages: number[], name: string): SplitPlanOutput {
  const pageNumbers = pages.map((page) => page + 1);
  return {
    id: `out-${index}`,
    name,
    pages,
    pageNumbers,
    label: describePages(pageNumbers),
  };
}

/**
 * Builds the output list for one document.
 *
 * `errors` is blocking: the UI refuses to start while it is non-empty.
 * `notes` is informational. `rowErrors` is keyed by `RangeRow.id` so the range
 * editor can mark the offending input without a second validation pass.
 */
export function buildSplitPlan(pageCount: number, settings: SplitSettings): SplitPlan {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return emptyPlan(['这份 PDF 没有可用页面，无法拆分。']);
  }

  const prefix = resolvePrefix(settings.prefix);
  const errors: string[] = [];
  const notes: string[] = [];
  const rowErrors: Record<string, string> = {};

  let groups: Array<{ pages: number[] }> = [];

  if (settings.mode === 'ranges') {
    const rows = settings.ranges.filter((row) => normalizeRangeInput(row.text).length > 0);

    for (const row of settings.ranges) {
      if (normalizeRangeInput(row.text).length === 0) continue;
      try {
        groups.push({ pages: parsePageRange(row.text, pageCount) });
      } catch (error) {
        if (error instanceof PageRangeError) rowErrors[row.id] = error.message;
        else rowErrors[row.id] = '这个范围无法解析。';
      }
    }

    const invalidRows = Object.keys(rowErrors).length;
    if (rows.length === 0) {
      errors.push('请至少填写一个页码范围，例如 1-5。');
    } else if (invalidRows > 0) {
      errors.push(`有 ${invalidRows} 个范围的页码需要修正。`);
    }

    // The same page may not land in two different files: it is almost always a
    // typo, and the result would look like a duplicated page.
    const owner = new Map<number, number>();
    const overlapping = new Set<number>();
    groups.forEach((group, groupIndex) => {
      for (const page of group.pages) {
        const previous = owner.get(page);
        if (previous !== undefined && previous !== groupIndex) overlapping.add(page);
        else owner.set(page, groupIndex);
      }
    });

    if (overlapping.size > 0) {
      const list = [...overlapping]
        .sort((a, b) => a - b)
        .slice(0, 5)
        .map((page) => page + 1)
        .join('、');
      errors.push(
        `第 ${list} 页同时出现在多个范围中，请调整后再拆分（重复页会生成两份相同内容）。`,
      );
    } else if (groups.length > 0 && owner.size < pageCount) {
      const missing = pageCount - owner.size;
      notes.push(`有 ${missing} 页不在任何范围内，不会被输出。`);
    }
  } else if (settings.mode === 'extract') {
    const requested = settings.extractPages;

    if (requested.length === 0) {
      errors.push('请至少选择一页后再提取。');
    }

    const outOfRange = requested.filter((page) => !Number.isInteger(page) || page < 0 || page >= pageCount);
    if (outOfRange.length > 0) {
      const list = outOfRange
        .slice(0, 5)
        .map((page) => page + 1)
        .join('、');
      errors.push(`页码 ${list} 超出范围（这份 PDF 共 ${pageCount} 页）。`);
    }

    const seen = new Set<number>();
    const unique: number[] = [];
    const duplicates: number[] = [];
    for (const page of requested) {
      if (seen.has(page)) duplicates.push(page);
      else {
        seen.add(page);
        unique.push(page);
      }
    }

    if (duplicates.length > 0) {
      const list = [...new Set(duplicates)]
        .slice(0, 5)
        .map((page) => page + 1)
        .join('、');
      notes.push(`已自动忽略重复页码：${list}。`);
    }

    if (outOfRange.length === 0 && unique.length > 0) {
      groups = [{ pages: unique }];
    }
  } else if (settings.mode === 'each') {
    groups = Array.from({ length: pageCount }, (_, index) => ({ pages: [index] }));
  } else {
    const size = Math.min(
      Math.max(1, Math.floor(Number(settings.chunkSize) || 1)),
      Math.max(1, pageCount),
      LIMITS.maxSplitChunkSize,
    );
    for (let start = 0; start < pageCount; start += size) {
      const end = Math.min(start + size, pageCount);
      groups.push({ pages: range(start, end) });
    }
  }

  if (errors.length > 0) {
    return { outputs: [], errors, notes, rowErrors };
  }

  if (groups.length > LIMITS.maxSplitOutputs) {
    return {
      outputs: [],
      errors: [`将生成 ${groups.length} 个文件，超过上限 ${LIMITS.maxSplitOutputs} 个。请改用范围或每份页数更大的设置。`],
      notes,
      rowErrors,
    };
  }

  const width = padWidth(groups.length);
  const outputs = groups.map((group, index) => {
    const number = String(index + 1).padStart(width, '0');
    let name: string;

    if (settings.mode === 'extract') {
      name = `${prefix}.pdf`;
    } else if (settings.naming === 'pages' && settings.mode !== 'each') {
      // `p1-5.pdf`, or `p1-12_8pages.pdf` when the pages are not contiguous.
      const compact = compactRanges(group.pages.map((page) => page + 1));
      const token =
        compact.length <= 24
          ? compact
          : `${group.pages[0] + 1}-${group.pages[group.pages.length - 1] + 1}_${group.pages.length}pages`;
      name = `${prefix}_p${token}.pdf`;
    } else {
      name = `${prefix}_${number}.pdf`;
    }
    return makeOutput(index, group.pages, name);
  });

  return { outputs, errors, notes, rowErrors };
}

function range(start: number, end: number): number[] {
  const result: number[] = [];
  for (let value = start; value < end; value += 1) result.push(value);
  return result;
}

/** Total pages across every output — used for the "预计" summary. */
export function planPageTotal(plan: SplitPlan): number {
  return plan.outputs.reduce((sum, output) => sum + output.pages.length, 0);
}

/** Short summary line for the build button, e.g. `4 个文件 · 20 页`. */
export function planSummary(plan: SplitPlan): string {
  if (plan.outputs.length === 0) return '尚无可输出的文件';
  const pages = planPageTotal(plan);
  return `${plan.outputs.length} 个文件 · ${pages} 页`;
}
