/**
 * Page range parsing.
 *
 * Rules inherited from the original desktop MVP (`pdfjoiner/core.py`):
 *  - page numbers are 1-based;
 *  - ranges are inclusive and must be ascending (`1-3`);
 *  - segments are separated by commas;
 *  - repeated pages are allowed on purpose (`1,1,3` puts page 1 twice);
 *  - the produced order is exactly the order the user typed.
 *
 * The output is always a list of **0-based page indices**.
 */

export type PageRangeErrorCode =
  | 'no-pages'
  | 'empty'
  | 'syntax'
  | 'order'
  | 'out-of-range'
  | 'empty-result';

export interface PageRangeErrorDetail {
  /** The offending segment, if the failure is localised to one. */
  segment?: string;
  pageCount?: number;
}

export class PageRangeError extends Error {
  readonly code: PageRangeErrorCode;
  readonly detail: PageRangeErrorDetail;

  constructor(code: PageRangeErrorCode, message: string, detail: PageRangeErrorDetail = {}) {
    super(message);
    this.name = 'PageRangeError';
    this.code = code;
    this.detail = detail;
  }
}

const ALL_TOKENS = new Set(['all', '*', '全部', '全部页面', '所有', '所有页面']);
const DASHES = /[—–－~～]/g;
const SPACES = /[\s\u3000]+/g;

/** Normalises the raw input: full-width punctuation, dashes and whitespace. */
export function normalizeRangeInput(input: string): string {
  return (input ?? '')
    .replace(/[，、]/g, ',')
    .replace(DASHES, '-')
    .replace(SPACES, '');
}

export function isAllPagesToken(input: string): boolean {
  const normalized = normalizeRangeInput(input).toLowerCase();
  return normalized === '' || ALL_TOKENS.has(normalized);
}

/**
 * Converts a user supplied range expression into ordered 0-based indices.
 *
 * @throws {PageRangeError} with a Chinese, user-facing message.
 */
export function parsePageRange(input: string, pageCount: number): number[] {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PageRangeError('no-pages', '该 PDF 没有可用页面，无法合并。', { pageCount });
  }

  const normalized = normalizeRangeInput(input);
  if (isAllPagesToken(normalized)) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  const segments = normalized.split(',');
  const indices: number[] = [];

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) {
      throw new PageRangeError('syntax', '页码范围中有空项，请检查逗号是否多写。', {
        segment: rawSegment,
        pageCount,
      });
    }

    if (segment.includes('-')) {
      const pieces = segment.split('-');
      if (pieces.length !== 2 || !pieces[0] || !pieces[1]) {
        throw new PageRangeError('syntax', `页码格式无法识别：「${segment}」。例：1-5 或 1-3,6,9`, {
          segment,
          pageCount,
        });
      }
      const [startText, endText] = pieces;
      if (!/^\d+$/.test(startText) || !/^\d+$/.test(endText)) {
        throw new PageRangeError('syntax', `页码必须是正整数：「${segment}」。`, {
          segment,
          pageCount,
        });
      }

      const start = Number(startText);
      const end = Number(endText);

      if (start < 1 || end < 1) {
        throw new PageRangeError('out-of-range', `页码从 1 开始，不能小于 1：「${segment}」。`, {
          segment,
          pageCount,
        });
      }
      if (start > end) {
        throw new PageRangeError(
          'order',
          `范围 ${segment} 的起始页大于结束页。如需倒序，请逐页填写，例如 ${end},${start}。`,
          { segment, pageCount },
        );
      }
      if (end > pageCount) {
        throw new PageRangeError(
          'out-of-range',
          `页码 ${end} 超出范围，该文件共 ${pageCount} 页。`,
          { segment, pageCount },
        );
      }

      for (let page = start; page <= end; page += 1) {
        indices.push(page - 1);
      }
      continue;
    }

    if (!/^\d+$/.test(segment)) {
      throw new PageRangeError('syntax', `页码格式无法识别：「${segment}」。只支持数字、逗号和连字符。`, {
        segment,
        pageCount,
      });
    }

    const page = Number(segment);
    if (page < 1) {
      throw new PageRangeError('out-of-range', `页码从 1 开始，不能小于 1：「${segment}」。`, {
        segment,
        pageCount,
      });
    }
    if (page > pageCount) {
      throw new PageRangeError(
        'out-of-range',
        `页码 ${page} 超出范围，该文件共 ${pageCount} 页。`,
        { segment, pageCount },
      );
    }
    indices.push(page - 1);
  }

  if (indices.length === 0) {
    throw new PageRangeError('empty-result', '没有选中任何页面。', { pageCount });
  }

  return indices;
}

/** Attempts to rebuild a compact range expression from an index list. */
export function formatAsRange(indices: readonly number[]): string | null {
  if (indices.length === 0) return null;

  for (let i = 1; i < indices.length; i += 1) {
    if (indices[i] !== indices[i - 1] + 1) return null;
  }

  const first = indices[0] + 1;
  const last = indices[indices.length - 1] + 1;
  return indices.length === 1 ? `${first}` : `${first}-${last}`;
}
