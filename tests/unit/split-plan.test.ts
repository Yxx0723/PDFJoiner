import { describe, expect, it } from 'vitest';

import {
  autoPrefix,
  buildSplitPlan,
  compactRanges,
  describePages,
  padWidth,
  planSummary,
  resolvePrefix,
} from '@/features/pdf-split/plan';
import type { RangeRow, SplitSettings } from '@/features/pdf-split/types';

function settings(patch: Partial<SplitSettings> = {}): SplitSettings {
  return {
    mode: 'ranges',
    ranges: [],
    extractPages: [],
    chunkSize: 5,
    prefix: 'doc',
    naming: 'index',
    ...patch,
  };
}

function rows(...texts: string[]): RangeRow[] {
  return texts.map((text, index) => ({ id: `r${index}`, text }));
}

describe('compactRanges / describePages', () => {
  it('compresses consecutive runs', () => {
    expect(compactRanges([1, 2, 3, 7])).toBe('1-3,7');
    expect(compactRanges([1, 3, 5])).toBe('1,3,5');
    expect(compactRanges([5])).toBe('5');
  });

  it('describes pages for the UI', () => {
    expect(describePages([1, 2, 3, 4, 5])).toBe('第 1–5 页');
    expect(describePages([1, 3, 5])).toBe('第 1、3、5 页');
    expect(describePages([7])).toBe('第 7 页');
    expect(describePages([])).toBe('无页面');
    expect(describePages([1, 2, 5, 9, 12, 20])).toBe('第 1–2、5、9、12… 页');
  });

  it('pads numbering to at least three digits', () => {
    expect(padWidth(4)).toBe(3);
    expect(padWidth(100)).toBe(3);
    expect(padWidth(1200)).toBe(4);
  });
});

describe('resolvePrefix / autoPrefix', () => {
  it('strips a .pdf suffix and illegal characters', () => {
    expect(resolvePrefix('Report A.pdf')).toBe('Report A');
    expect(resolvePrefix('a/b:c*d')).toBe('abcd');
    expect(resolvePrefix('   ')).toBe('split');
  });

  it('derives a sensible default per mode', () => {
    expect(autoPrefix('ranges', 'report-a.pdf')).toBe('report-a');
    expect(autoPrefix('chunks', 'report-a.pdf')).toBe('report-a');
    expect(autoPrefix('each', 'document.pdf')).toBe('document_page');
    expect(autoPrefix('extract', 'document.pdf')).toBe('document_extract');
  });
});

describe('buildSplitPlan — ranges', () => {
  it('produces one file per range, in row order', () => {
    const plan = buildSplitPlan(
      20,
      settings({ ranges: rows('1-5', '6-10', '11-15', '16-20') }),
    );

    expect(plan.errors).toEqual([]);
    expect(plan.outputs).toHaveLength(4);
    expect(plan.outputs.map((output) => output.name)).toEqual([
      'doc_001.pdf',
      'doc_002.pdf',
      'doc_003.pdf',
      'doc_004.pdf',
    ]);
    expect(plan.outputs[0].pages).toEqual([0, 1, 2, 3, 4]);
    expect(plan.outputs[0].label).toBe('第 1–5 页');
    expect(plan.outputs[3].pages).toEqual([15, 16, 17, 18, 19]);
    expect(planPageTotal(plan)).toBe(20);
  });

  it('supports multi-segment ranges inside one row', () => {
    const plan = buildSplitPlan(20, settings({ ranges: rows('1-3,7', '9') }));
    expect(plan.errors).toEqual([]);
    expect(plan.outputs[0].pages).toEqual([0, 1, 2, 6]);
    expect(plan.outputs[0].pageNumbers).toEqual([1, 2, 3, 7]);
    expect(plan.outputs[1].pages).toEqual([8]);
  });

  it('flags overlapping ranges instead of silently duplicating pages', () => {
    const plan = buildSplitPlan(20, settings({ ranges: rows('1-10', '8-15') }));
    expect(plan.outputs).toEqual([]);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0]).toContain('8、9、10');
    expect(plan.errors[0]).toContain('同时出现在多个范围中');
  });

  it('reports uncovered pages as a note, not an error', () => {
    const plan = buildSplitPlan(20, settings({ ranges: rows('1-5') }));
    expect(plan.errors).toEqual([]);
    expect(plan.outputs).toHaveLength(1);
    expect(plan.notes.join()).toContain('15 页不在任何范围内');
  });

  it('marks the offending row and blocks the plan', () => {
    const plan = buildSplitPlan(10, settings({ ranges: rows('1-5', '8-12') }));
    expect(plan.rowErrors.r1).toContain('超出范围');
    expect(plan.errors[0]).toContain('1 个范围');
    expect(plan.outputs).toEqual([]);
  });

  it('rejects an empty range list', () => {
    const plan = buildSplitPlan(10, settings({ ranges: rows('', '   ') }));
    expect(plan.errors[0]).toContain('请至少填写一个页码范围');
  });

  it('rejects a descending range', () => {
    const plan = buildSplitPlan(10, settings({ ranges: rows('5-2') }));
    expect(plan.rowErrors.r0).toContain('起始页大于结束页');
  });
});

describe('buildSplitPlan — extract', () => {
  it('keeps the page order the user asked for', () => {
    const plan = buildSplitPlan(
      20,
      settings({ mode: 'extract', extractPages: [0, 2, 4, 7, 8, 9, 10, 11] }),
    );

    expect(plan.errors).toEqual([]);
    expect(plan.outputs).toHaveLength(1);
    expect(plan.outputs[0].pages).toEqual([0, 2, 4, 7, 8, 9, 10, 11]);
    expect(plan.outputs[0].name).toBe('doc.pdf');
    expect(plan.outputs[0].label).toBe('第 1、3、5、8–12 页');
  });

  it('honours a reversed order', () => {
    const plan = buildSplitPlan(10, settings({ mode: 'extract', extractPages: [4, 0, 2] }));
    expect(plan.outputs[0].pages).toEqual([4, 0, 2]);
    expect(plan.outputs[0].label).toBe('第 5、1、3 页');
  });

  it('drops duplicates and says so', () => {
    const plan = buildSplitPlan(10, settings({ mode: 'extract', extractPages: [1, 1, 4] }));
    expect(plan.outputs[0].pages).toEqual([1, 4]);
    expect(plan.notes.join()).toContain('已自动忽略重复页码：2');
  });

  it('rejects an empty selection and out-of-range pages', () => {
    expect(
      buildSplitPlan(10, settings({ mode: 'extract', extractPages: [] })).errors[0],
    ).toContain('请至少选择一页');

    const outOfRange = buildSplitPlan(10, settings({ mode: 'extract', extractPages: [0, 99] }));
    expect(outOfRange.errors[0]).toContain('超出范围');
    expect(outOfRange.outputs).toEqual([]);
  });
});

describe('buildSplitPlan — each', () => {
  it('produces one file per page with continuous numbering', () => {
    const plan = buildSplitPlan(10, settings({ mode: 'each', prefix: 'document_page' }));
    expect(plan.outputs).toHaveLength(10);
    expect(plan.outputs.map((output) => output.name)).toEqual([
      'document_page_001.pdf',
      'document_page_002.pdf',
      'document_page_003.pdf',
      'document_page_004.pdf',
      'document_page_005.pdf',
      'document_page_006.pdf',
      'document_page_007.pdf',
      'document_page_008.pdf',
      'document_page_009.pdf',
      'document_page_010.pdf',
    ]);
    // Every file holds exactly one page, and the order follows the source.
    expect(plan.outputs.map((output) => output.pages)).toEqual(
      Array.from({ length: 10 }, (_, index) => [index]),
    );
  });

  it('works for a single-page document', () => {
    const plan = buildSplitPlan(1, settings({ mode: 'each' }));
    expect(plan.outputs).toHaveLength(1);
    expect(plan.outputs[0].name).toBe('doc_001.pdf');
  });

  it('numbers 100 files with three digits', () => {
    const plan = buildSplitPlan(100, settings({ mode: 'each' }));
    expect(plan.outputs).toHaveLength(100);
    expect(plan.outputs[99].name).toBe('doc_100.pdf');
  });
});

describe('buildSplitPlan — chunks', () => {
  it('splits 23 pages into 5 / 5 / 5 / 5 / 3', () => {
    const plan = buildSplitPlan(23, settings({ mode: 'chunks', chunkSize: 5 }));
    expect(plan.outputs).toHaveLength(5);
    expect(plan.outputs.map((output) => output.pages.length)).toEqual([5, 5, 5, 5, 3]);
    expect(plan.outputs[4].pages).toEqual([20, 21, 22]);
    expect(plan.outputs[4].label).toBe('第 21–23 页');
  });

  it('produces a single file when the chunk is larger than the document', () => {
    const plan = buildSplitPlan(3, settings({ mode: 'chunks', chunkSize: 50 }));
    expect(plan.outputs).toHaveLength(1);
    expect(plan.outputs[0].pages).toEqual([0, 1, 2]);
  });

  it('clamps nonsense values instead of crashing', () => {
    const zero = buildSplitPlan(4, settings({ mode: 'chunks', chunkSize: 0 }));
    expect(zero.outputs).toHaveLength(4);

    const huge = buildSplitPlan(4, settings({ mode: 'chunks', chunkSize: 99999 }));
    expect(huge.outputs).toHaveLength(1);
  });
});

describe('buildSplitPlan — naming', () => {
  it('uses page tokens when requested, and falls back for long ones', () => {
    const ranged = buildSplitPlan(
      20,
      settings({ mode: 'ranges', naming: 'pages', ranges: rows('1-5', '6-10') }),
    );
    expect(ranged.outputs[0].name).toBe('doc_p1-5.pdf');

    const scattered = buildSplitPlan(
      20,
      settings({
        mode: 'extract',
        naming: 'pages',
        extractPages: Array.from({ length: 15 }, (_, index) => index),
      }),
    );
    // A single contiguous run still fits the short form.
    expect(scattered.outputs[0].name).toBe('doc.pdf');
  });

  it('summarises the plan for the build button', () => {
    expect(planSummary(buildSplitPlan(20, settings({ ranges: rows('1-10', '11-20') })))).toBe(
      '2 个文件 · 20 页',
    );
    expect(planSummary(buildSplitPlan(20, settings({ ranges: rows('') })))).toBe(
      '尚无可输出的文件',
    );
  });
});

describe('buildSplitPlan — limits', () => {
  it('refuses to produce more files than the configured ceiling', () => {
    const plan = buildSplitPlan(600, settings({ mode: 'each' }));
    expect(plan.outputs).toEqual([]);
    expect(plan.errors[0]).toContain('超过上限');
  });

  it('returns a single error for a document with no pages', () => {
    const plan = buildSplitPlan(0, settings());
    expect(plan.errors[0]).toContain('没有可用页面');
  });
});

function planPageTotal(plan: ReturnType<typeof buildSplitPlan>): number {
  return plan.outputs.reduce((sum, output) => sum + output.pages.length, 0);
}
