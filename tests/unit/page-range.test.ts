import { describe, expect, it } from 'vitest';

import {
  PageRangeError,
  formatAsRange,
  isAllPagesToken,
  normalizeRangeInput,
  parsePageRange,
} from '@/features/page-range/parse-page-range';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof PageRangeError) return error.code;
    return 'unexpected';
  }
  return 'no-error';
}

describe('parsePageRange', () => {
  it('returns every page for empty input, "all" and "*"', () => {
    expect(parsePageRange('', 4)).toEqual([0, 1, 2, 3]);
    expect(parsePageRange('all', 4)).toEqual([0, 1, 2, 3]);
    expect(parsePageRange('*', 4)).toEqual([0, 1, 2, 3]);
    expect(parsePageRange('全部', 4)).toEqual([0, 1, 2, 3]);
    expect(parsePageRange('全部页面', 4)).toEqual([0, 1, 2, 3]);
  });

  it('parses single pages and inclusive ranges', () => {
    expect(parsePageRange('1', 5)).toEqual([0]);
    expect(parsePageRange('1-3', 5)).toEqual([0, 1, 2]);
    expect(parsePageRange('3-3', 5)).toEqual([2]);
    expect(parsePageRange('1-5', 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('supports multi segment ranges and preserves typing order', () => {
    expect(parsePageRange('1-3,6,9-10', 12)).toEqual([0, 1, 2, 5, 8, 9]);
    expect(parsePageRange('3,1', 5)).toEqual([2, 0]);
  });

  it('allows repeated pages on purpose', () => {
    expect(parsePageRange('1,1,3', 5)).toEqual([0, 0, 2]);
  });

  it('tolerates full-width commas, en dashes and whitespace', () => {
    expect(normalizeRangeInput('1，3')).toBe('1,3');
    expect(parsePageRange('1，3', 5)).toEqual([0, 2]);
    expect(parsePageRange('1 – 3', 5)).toEqual([0, 1, 2]);
    expect(parsePageRange(' 1 - 2 , 4 ', 5)).toEqual([0, 1, 3]);
    // Full-width digits are not silently coerced; the user gets a clear error.
    expect(codeOf(() => parsePageRange('１-２', 5))).toBe('syntax');
  });

  it('rejects out of range pages with the page count in the message', () => {
    expect(codeOf(() => parsePageRange('7', 5))).toBe('out-of-range');
    expect(codeOf(() => parsePageRange('1-7', 5))).toBe('out-of-range');
    expect(codeOf(() => parsePageRange('0', 5))).toBe('out-of-range');

    try {
      parsePageRange('7', 5);
    } catch (error) {
      expect((error as PageRangeError).message).toContain('共 5 页');
    }
  });

  it('rejects descending ranges with an actionable message', () => {
    expect(codeOf(() => parsePageRange('5-3', 8))).toBe('order');
    try {
      parsePageRange('5-3', 8);
    } catch (error) {
      expect((error as PageRangeError).message).toContain('3,5');
    }
  });

  it('rejects malformed segments', () => {
    expect(codeOf(() => parsePageRange('1,,3', 5))).toBe('syntax');
    expect(codeOf(() => parsePageRange('1-', 5))).toBe('syntax');
    expect(codeOf(() => parsePageRange('a-b', 5))).toBe('syntax');
    expect(codeOf(() => parsePageRange('1.5', 5))).toBe('syntax');
    expect(codeOf(() => parsePageRange('1-2-3', 5))).toBe('syntax');
  });

  it('rejects documents without pages', () => {
    expect(codeOf(() => parsePageRange('1', 0))).toBe('no-pages');
  });

  it('never silently drops a segment', () => {
    expect(parsePageRange('1,1,1', 1)).toHaveLength(3);
  });
});

describe('formatAsRange', () => {
  it('collapses consecutive pages', () => {
    expect(formatAsRange([0, 1, 2])).toBe('1-3');
    expect(formatAsRange([4])).toBe('5');
    expect(formatAsRange([])).toBeNull();
  });

  it('refuses to collapse non consecutive or unordered selections', () => {
    expect(formatAsRange([0, 2])).toBeNull();
    expect(formatAsRange([1, 0])).toBeNull();
    expect(formatAsRange([0, 0, 1])).toBeNull();
  });

  it('round-trips through the parser', () => {
    const pages = [0, 1, 2, 5, 6];
    const expression = formatAsRange([0, 1, 2]);
    expect(expression).toBe('1-3');
    expect(parsePageRange(expression!, 10)).toEqual([0, 1, 2]);
    expect(pages.length).toBe(5);
  });
});

describe('isAllPagesToken', () => {
  it('recognises the documented aliases', () => {
    expect(isAllPagesToken('')).toBe(true);
    expect(isAllPagesToken('ALL')).toBe(true);
    expect(isAllPagesToken('全部')).toBe(true);
    expect(isAllPagesToken('2')).toBe(false);
  });
});
