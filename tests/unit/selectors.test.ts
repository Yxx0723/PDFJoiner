import { describe, expect, it } from 'vitest';

import { formatBytes, formatDuration, ratio, sanitizeFileName } from '@/lib/utils';
import { describeCaveats, getMergeBlockers, selectionInputValue, summarize } from '@/store/selectors';
import type { PdfFileEntry } from '@/store/use-app-store';

function makeEntry(patch: Partial<PdfFileEntry> = {}): PdfFileEntry {
  return {
    id: Math.random().toString(36).slice(2),
    file: new File([new Uint8Array(8)], 'a.pdf'),
    name: 'a.pdf',
    size: 1024,
    status: 'ready',
    pageCount: 3,
    selection: { pages: null, source: 'all', draft: null },
    expanded: false,
    ...patch,
  };
}

describe('formatBytes', () => {
  it('uses binary units with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 * 3.25)).toBe('3.3 MB');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('scales from milliseconds to minutes', () => {
    expect(formatDuration(420)).toBe('420 毫秒');
    expect(formatDuration(1500)).toBe('1.5 秒');
    expect(formatDuration(65_000)).toBe('1 分 5 秒');
  });
});

describe('ratio', () => {
  it('clamps to 0..1 and survives a zero total', () => {
    expect(ratio(5, 10)).toBe(0.5);
    expect(ratio(20, 10)).toBe(1);
    expect(ratio(5, 0)).toBe(0);
  });
});

describe('sanitizeFileName', () => {
  it('strips illegal characters and normalises the extension', () => {
    expect(sanitizeFileName('a/b:c*.pdf')).toBe('abc.pdf');
    expect(sanitizeFileName('  report  ')).toBe('report.pdf');
    expect(sanitizeFileName('report.PDF')).toBe('report.pdf');
    expect(sanitizeFileName('')).toBe('merged.pdf');
    expect(sanitizeFileName('   ')).toBe('merged.pdf');
  });

  it('keeps CJK characters intact', () => {
    expect(sanitizeFileName('合并结果 2026')).toBe('合并结果 2026.pdf');
  });

  it('limits the length', () => {
    expect(sanitizeFileName('x'.repeat(300)).length).toBeLessThanOrEqual(124);
  });
});

describe('summarize', () => {
  it('counts files, selected pages and input bytes', () => {
    const entries = [
      makeEntry({ size: 1000 }),
      makeEntry({ size: 2048, selection: { pages: [0], source: 'custom', draft: null } }),
      makeEntry({ status: 'error', pageCount: 0 }),
    ];
    const summary = summarize(entries);
    expect(summary.fileCount).toBe(3);
    expect(summary.readyCount).toBe(2);
    expect(summary.errorCount).toBe(1);
    expect(summary.outputPages).toBe(4); // 3 + 1, error entry contributes nothing
    expect(summary.inputBytes).toBe(4072);
  });
});

describe('selectionInputValue', () => {
  it('reflects the draft while typing', () => {
    expect(selectionInputValue(makeEntry({ selection: { pages: null, source: 'range', draft: '1-2' } }))).toBe(
      '1-2',
    );
  });

  it('derives a compact expression from the selection', () => {
    expect(selectionInputValue(makeEntry())).toBe('');
    expect(
      selectionInputValue(makeEntry({ selection: { pages: [0, 1, 2], source: 'custom', draft: null } })),
    ).toBe('1-3');
    expect(
      selectionInputValue(makeEntry({ selection: { pages: [0, 2], source: 'custom', draft: null } })),
    ).toBe('1,3');
  });
});

describe('getMergeBlockers', () => {
  it('blocks on empty, reading, failed, invalid and empty selections', () => {
    expect(getMergeBlockers([], false)[0]).toContain('先添加');
    expect(getMergeBlockers([makeEntry({ status: 'reading' })], false)[0]).toContain('正在读取');
    expect(getMergeBlockers([makeEntry({ status: 'error' })], false)[0]).toContain('无法处理');
    expect(
      getMergeBlockers(
        [makeEntry({ selection: { pages: [0], source: 'range', draft: '1-9', error: '超出范围' } })],
        false,
      )[0],
    ).toContain('页码范围');
    expect(
      getMergeBlockers(
        [makeEntry({ selection: { pages: [], source: 'custom', draft: null } })],
        false,
      )[0],
    ).toContain('没有选中');
  });

  it('passes for a healthy task', () => {
    expect(getMergeBlockers([makeEntry()], false)).toEqual([]);
  });

  it('blocks while a merge is running', () => {
    expect(getMergeBlockers([makeEntry()], true)[0]).toContain('正在合并');
  });
});

describe('describeCaveats', () => {
  it('warns about signatures, forms, outlines and mixed sizes', () => {
    const notes = describeCaveats(
      makeEntry({
        inspection: {
          pageCount: 2,
          pageSizes: [
            { width: 595, height: 842, rotation: 0 },
            { width: 842, height: 595, rotation: 0 },
          ],
          hasForms: true,
          hasSignatures: true,
          hasOutlines: true,
          hasAnnotations: false,
        },
      }),
    );

    expect(notes).toHaveLength(4);
    expect(notes.join(' ')).toContain('数字签名');
    expect(notes.join(' ')).toContain('表单');
    expect(notes.join(' ')).toContain('书签');
    expect(notes.join(' ')).toContain('不同纸张尺寸');
  });

  it('stays quiet for plain documents', () => {
    expect(
      describeCaveats(
        makeEntry({
          inspection: {
            pageCount: 1,
            pageSizes: [{ width: 595, height: 842, rotation: 0 }],
            hasForms: false,
            hasSignatures: false,
            hasOutlines: false,
            hasAnnotations: false,
          },
        }),
      ),
    ).toEqual([]);
  });
});
