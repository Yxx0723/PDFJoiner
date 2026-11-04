import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MergeCancelledError, PdfEngineError } from '@/features/pdf/errors';

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  merge: vi.fn(),
  cancel: vi.fn(),
  terminate: vi.fn(),
  release: vi.fn(),
  releaseAll: vi.fn(),
}));

vi.mock('@/features/pdf/engine-client', () => ({
  pdfEngine: {
    inspect: mocks.inspect,
    merge: mocks.merge,
    cancel: mocks.cancel,
    terminate: mocks.terminate,
  },
}));

vi.mock('@/features/preview/thumbnail-service', () => ({
  thumbnailService: { release: mocks.release, releaseAll: mocks.releaseAll, peek: () => undefined },
}));

import { useAppStore } from '@/store/use-app-store';
import { getMergeBlockers, summarize } from '@/store/selectors';

const INSPECTION = {
  pageCount: 3,
  pageSizes: [{ width: 595, height: 842, rotation: 0 }],
  hasForms: false,
  hasSignatures: false,
  hasOutlines: false,
  hasAnnotations: false,
};

function makeFile(name: string, bytes = 12, lastModified = 1_700_000_000_000): File {
  return new File([new Uint8Array(bytes)], name, {
    type: 'application/pdf',
    lastModified,
  });
}

function reset() {
  useAppStore.setState({
    files: [],
    outputName: '',
    merge: { status: 'idle', progress: null, error: null, result: null, startedAt: null },
  });
}

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:mock-result'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  reset();
  mocks.inspect.mockResolvedValue(INSPECTION);
});

describe('addFiles', () => {
  it('adds PDFs, inspects them and defaults to all pages', async () => {
    const summary = await useAppStore.getState().addFiles([makeFile('a.pdf'), makeFile('b.pdf')]);

    expect(summary).toEqual({ added: 2, duplicates: [], rejected: [] });
    const { files } = useAppStore.getState();
    expect(files).toHaveLength(2);
    expect(files[0].status).toBe('ready');
    expect(files[0].pageCount).toBe(3);
    expect(files[0].selection.pages).toBeNull();
    expect(useAppStore.getState().files[0].expanded).toBe(false);
  });

  it('auto expands the page strip when a single file is imported', async () => {
    await useAppStore.getState().addFiles([makeFile('only.pdf')]);
    expect(useAppStore.getState().files[0].expanded).toBe(true);
  });

  it('rejects non-PDF, empty and oversized files with reasons', async () => {
    const summary = await useAppStore.getState().addFiles([
      makeFile('notes.txt'),
      makeFile('empty.pdf', 0),
    ]);

    expect(summary.added).toBe(0);
    expect(summary.rejected.map((item) => item.reason).join(' ')).toContain('不是 PDF');
    expect(summary.rejected.map((item) => item.reason).join(' ')).toContain('文件为空');
    expect(useAppStore.getState().files).toHaveLength(0);
  });

  it('skips exact duplicates but allows a same-named file with other metadata', async () => {
    await useAppStore.getState().addFiles([makeFile('a.pdf', 12, 1000)]);
    const summary = await useAppStore.getState().addFiles([
      makeFile('a.pdf', 12, 1000),
      makeFile('a.pdf', 12, 2000),
    ]);

    expect(summary.added).toBe(1);
    expect(summary.duplicates).toEqual(['a.pdf']);
    expect(useAppStore.getState().files).toHaveLength(2);
  });

  it('keeps encrypted files visible with an actionable error', async () => {
    mocks.inspect.mockRejectedValueOnce(
      new PdfEngineError('encrypted', '该 PDF 已加密（需要密码）。'),
    );

    await useAppStore.getState().addFiles([makeFile('locked.pdf')]);
    const [entry] = useAppStore.getState().files;

    expect(entry.status).toBe('error');
    expect(entry.error?.code).toBe('encrypted');
    expect(getMergeBlockers(useAppStore.getState().files, false)[0]).toContain('无法处理');
  });
});

describe('page selection', () => {
  beforeEach(async () => {
    await useAppStore.getState().addFiles([makeFile('a.pdf')]);
  });

  it('toggles a single page off and back on', () => {
    const id = useAppStore.getState().files[0].id;

    useAppStore.getState().togglePage(id, 1);
    let entry = useAppStore.getState().files[0];
    expect(entry.selection.pages).toEqual([0, 2]);
    expect(entry.selection.source).toBe('custom');

    useAppStore.getState().togglePage(id, 1);
    entry = useAppStore.getState().files[0];
    expect(entry.selection.pages).toEqual([0, 1, 2]);
    expect(entry.selection.source).toBe('all');
  });

  it('parses a valid range and stores the ordered indices', () => {
    const id = useAppStore.getState().files[0].id;

    useAppStore.getState().setRangeDraft(id, '3,1');
    const entry = useAppStore.getState().files[0];
    expect(entry.selection.pages).toEqual([2, 0]);
    expect(entry.selection.error).toBeUndefined();
  });

  it('keeps the last valid selection and surfaces the error for a bad range', () => {
    const id = useAppStore.getState().files[0].id;

    useAppStore.getState().setRangeDraft(id, '1-2');
    useAppStore.getState().setRangeDraft(id, '1-9');

    const entry = useAppStore.getState().files[0];
    expect(entry.selection.error).toContain('超出范围');
    expect(entry.selection.pages).toEqual([0, 1]);
    expect(getMergeBlockers(useAppStore.getState().files, false)[0]).toContain('页码范围');
  });

  it('resets to all pages', () => {
    const id = useAppStore.getState().files[0].id;
    useAppStore.getState().setRangeDraft(id, '2');
    useAppStore.getState().resetSelection(id);
    expect(useAppStore.getState().files[0].selection.pages).toBeNull();
  });
});

describe('ordering', () => {
  beforeEach(async () => {
    await useAppStore.getState().addFiles([makeFile('a.pdf'), makeFile('b.pdf'), makeFile('c.pdf')]);
  });

  it('moves a file up and down within bounds', () => {
    const [a, b] = useAppStore.getState().files;

    useAppStore.getState().moveFile(b.id, -1);
    expect(useAppStore.getState().files.map((f) => f.name)).toEqual(['b.pdf', 'a.pdf', 'c.pdf']);

    useAppStore.getState().moveFile(b.id, -1); // already first
    expect(useAppStore.getState().files.map((f) => f.name)).toEqual(['b.pdf', 'a.pdf', 'c.pdf']);

    useAppStore.getState().moveFile(a.id, 1);
    expect(useAppStore.getState().files.map((f) => f.name)).toEqual(['b.pdf', 'c.pdf', 'a.pdf']);
  });

  it('reorders by drag target', () => {
    const [a, , c] = useAppStore.getState().files;
    useAppStore.getState().reorderFiles(c.id, a.id);
    expect(useAppStore.getState().files.map((f) => f.name)).toEqual(['c.pdf', 'a.pdf', 'b.pdf']);
  });

  it('ignores unknown ids', () => {
    useAppStore.getState().reorderFiles('nope', 'also-nope');
    expect(useAppStore.getState().files).toHaveLength(3);
  });
});

describe('startMerge', () => {
  beforeEach(async () => {
    await useAppStore.getState().addFiles([makeFile('a.pdf'), makeFile('b.pdf')]);
    useAppStore.getState().setOutputName('季度合并');
  });

  it('sends the exact file and page plan to the engine', async () => {
    const [, b] = useAppStore.getState().files;
    useAppStore.getState().setRangeDraft(b.id, '3');

    mocks.merge.mockImplementation(async (request: { files: unknown[]; onProgress?: (p: unknown) => void; getBytes: (i: number) => Promise<Uint8Array> }) => {
      request.onProgress?.({
        stage: 'copying',
        fileIndex: 0,
        fileCount: 2,
        fileName: 'a.pdf',
        pagesDone: 1,
        pagesTotal: 4,
      });
      const bytes = await request.getBytes(0);
      expect(bytes.byteLength).toBe(12);
      return { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), pageCount: 4, verified: true };
    });

    await useAppStore.getState().startMerge();

    const request = mocks.merge.mock.calls[0][0];
    expect(request.files).toEqual([
      { name: 'a.pdf', pages: [0, 1, 2] },
      { name: 'b.pdf', pages: [2] },
    ]);
    expect(request.title).toBe('季度合并');

    const { merge } = useAppStore.getState();
    expect(merge.status).toBe('success');
    expect(merge.result?.pageCount).toBe(4);
    expect(merge.result?.url).toBe('blob:mock-result');
    expect(merge.result?.fileName).toBe('季度合并.pdf');
    expect(merge.result?.verified).toBe(true);
  });

  it('returns to idle when the user cancels', async () => {
    mocks.merge.mockRejectedValue(new MergeCancelledError());

    await useAppStore.getState().startMerge();
    expect(useAppStore.getState().merge.status).toBe('idle');
    expect(useAppStore.getState().merge.error).toBeNull();
  });

  it('never reports success when the engine fails', async () => {
    mocks.merge.mockRejectedValue(new PdfEngineError('out-of-memory', '浏览器可用内存不足。'));

    await useAppStore.getState().startMerge();
    const { merge } = useAppStore.getState();
    expect(merge.status).toBe('error');
    expect(merge.result).toBeNull();
    expect(merge.error).toContain('内存');
  });

  it('does nothing when there is no page to merge', async () => {
    const ids = useAppStore.getState().files.map((entry) => entry.id);
    for (const id of ids) {
      for (const page of [0, 1, 2]) useAppStore.getState().togglePage(id, page);
    }

    await useAppStore.getState().startMerge();
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(useAppStore.getState().merge.status).toBe('error');
    expect(useAppStore.getState().merge.error).toContain('没有可合并的页面');
  });
});

describe('clearAll', () => {
  it('drops files, name and results', async () => {
    await useAppStore.getState().addFiles([makeFile('a.pdf')]);
    useAppStore.getState().setOutputName('x');
    useAppStore.getState().clearAll();

    const state = useAppStore.getState();
    expect(state.files).toEqual([]);
    expect(state.outputName).toBe('');
    expect(state.merge.status).toBe('idle');
    expect(summarize(state.files).fileCount).toBe(0);
  });
});
