/**
 * Store tests for the rotation tool (P2).
 *
 * The worker client and the thumbnail service are mocked; all rotation,
 * history, scope and task-state logic is the real store code.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PdfEngineError, MergeCancelledError } from '@/features/pdf/errors';
import type { RotateInspection } from '@/features/pdf-rotate/types';
import {
  deltasOf,
  finalAnglesOf,
  outputNameOf,
  resolveScope,
  rotatedCountOf,
  useRotateStore,
} from '@/store/use-rotate-store';

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  rotate: vi.fn(),
  cancel: vi.fn(),
  terminate: vi.fn(),
  release: vi.fn(),
  releasePage: vi.fn(),
}));

vi.mock('@/features/pdf-rotate/client', () => ({
  rotateEngine: {
    inspect: mocks.inspect,
    rotate: mocks.rotate,
    cancel: mocks.cancel,
    terminate: mocks.terminate,
  },
}));

vi.mock('@/features/preview/thumbnail-service', () => ({
  thumbnailService: {
    release: mocks.release,
    releasePage: mocks.releasePage,
    releaseAll: vi.fn(),
    peek: () => undefined,
  },
}));

const FACTS: RotateInspection = {
  pageCount: 5,
  rotations: [0, 90, 180, 270, 0],
  inspection: {
    pageCount: 5,
    pageSizes: [{ width: 595.28, height: 841.89, rotation: 0 }],
    hasForms: false,
    hasSignatures: false,
    hasOutlines: false,
    hasAnnotations: false,
  },
};

const OUTCOME = {
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  pageCount: 5,
  rotations: [0, 90, 180, 270, 0],
  verified: true,
};

function makeFile(name = 'report.pdf', content = '%PDF-1.4\nfixture bytes\n'): File {
  return new File([new TextEncoder().encode(content)], name, {
    type: 'application/pdf',
    lastModified: 1_700_000_000_000,
  });
}

async function loaded(): Promise<void> {
  const outcome = await useRotateStore.getState().addDocument([makeFile()]);
  expect(outcome.accepted).toBe(true);
  expect(useRotateStore.getState().document?.status).toBe('ready');
}

function state() {
  return useRotateStore.getState();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspect.mockResolvedValue(FACTS);
  mocks.rotate.mockResolvedValue(OUTCOME);
  useRotateStore.setState({
    document: null,
    history: { entries: [[]], index: 0, limit: 60 },
    scope: 'all',
    currentPage: 1,
    rangeDraft: '',
    rangeError: null,
    exportStatus: 'idle',
    progress: null,
    error: null,
    result: null,
  });
});

describe('import', () => {
  it('reads real per-page rotations and starts with zero deltas', async () => {
    await loaded();
    const doc = state().document!;
    expect(doc.pageCount).toBe(5);
    expect(doc.originalRotations).toEqual([0, 90, 180, 270, 0]);
    expect(deltasOf(state())).toEqual([0, 0, 0, 0, 0]);
    expect(finalAnglesOf(state())).toEqual([0, 90, 180, 270, 0]);
  });

  it('rejects multiple files, wrong extension, empty and disguised files', async () => {
    expect((await state().addDocument([makeFile(), makeFile('b.pdf')])).message).toContain('一次只处理一个');
    expect((await state().addDocument([makeFile('notes.txt')])).message).toContain('不是 PDF');
    expect((await state().addDocument([new File([], 'empty.pdf')])).message).toContain('为空');
    expect(
      (await state().addDocument([makeFile('fake.pdf', 'this is not a pdf')])).message,
    ).toContain('不是 PDF');
    expect(state().document).toBeNull();
  });

  it('rejects a file above the size limit', async () => {
    const big = makeFile();
    Object.defineProperty(big, 'size', { value: 201 * 1024 * 1024 });
    expect((await state().addDocument([big])).message).toContain('超过单文件上限');
  });

  it('surfaces an encrypted / broken document as an error, not as loaded', async () => {
    mocks.inspect.mockRejectedValueOnce(new PdfEngineError('encrypted', '该 PDF 已加密。'));
    const outcome = await state().addDocument([makeFile('locked.pdf')]);

    expect(outcome.accepted).toBe(true);
    expect(outcome.message).toContain('加密');
    expect(state().document?.status).toBe('error');
    expect(state().document?.error?.code).toBe('encrypted');
  });

  it('a late inspection cannot overwrite a replaced document', async () => {
    const finishFirst: Array<(value: RotateInspection) => void> = [];
    mocks.inspect.mockImplementationOnce(
      () => new Promise<RotateInspection>((resolve) => { finishFirst.push(resolve); }),
    );
    const first = state().addDocument([makeFile('first.pdf')]);

    const other: RotateInspection = {
      ...FACTS,
      pageCount: 2,
      rotations: [0, 0],
      inspection: { ...FACTS.inspection, pageCount: 2 },
    };
    mocks.inspect.mockResolvedValueOnce(other);
    await state().addDocument([makeFile('second.pdf')]);

    finishFirst[0]?.(FACTS);
    await first;

    expect(state().document?.name).toBe('second.pdf');
    expect(state().document?.pageCount).toBe(2);
    expect(deltasOf(state())).toEqual([0, 0]);
  });
});

describe('selection and scope', () => {
  beforeEach(loaded);

  it('toggles, selects all, inverts and clears', () => {
    state().selectPage(1);
    expect(state().document?.selectedPages).toEqual([1]);
    state().selectPage(1);
    expect(state().document?.selectedPages).toEqual([]);
    state().selectPage(0);
    state().selectPage(2);
    state().invertSelection();
    expect(state().document?.selectedPages).toEqual([1, 3, 4]);
    state().selectAllPages();
    expect(state().document?.selectedPages).toEqual([0, 1, 2, 3, 4]);
    state().clearSelection();
    expect(state().document?.selectedPages).toEqual([]);
  });

  it('resolves the four scopes to concrete pages', () => {
    state().setCurrentPage(3);
    expect(resolveScope(state(), 'page').indices).toEqual([2]);

    state().selectPage(0);
    state().selectPage(4);
    expect(resolveScope(state(), 'selected').indices).toEqual([0, 4]);

    state().setRangeDraft('2-3,5,5');
    expect(resolveScope(state(), 'range').indices).toEqual([1, 2, 4]);
    expect(state().rangeError).toBeNull();

    expect(resolveScope(state(), 'all').indices).toEqual([0, 1, 2, 3, 4]);
  });

  it('reports an invalid range instead of rotating anything', () => {
    state().setRangeDraft('1-99');
    expect(state().rangeError).toContain('超出范围');
    expect(resolveScope(state(), 'range').error).toContain('超出范围');
    state().rotateBy(90, 'range');
    expect(rotatedCountOf(state())).toBe(0);
  });

  it('an empty selection is an error, not a silent no-op', () => {
    expect(resolveScope(state(), 'selected').error).toContain('没有勾选');
    state().rotateBy(90, 'selected');
    expect(rotatedCountOf(state())).toBe(0);
  });
});

describe('rotation edits and history', () => {
  beforeEach(loaded);

  it('single-page rotation keeps the source rotation and only changes one page', () => {
    state().rotatePage(2, 90);
    expect(deltasOf(state())).toEqual([0, 0, 90, 0, 0]);
    expect(finalAnglesOf(state())).toEqual([0, 90, 270, 270, 0]);
    expect(rotatedCountOf(state())).toBe(1);
  });

  it('selected, range and all-page rotations work through one shared formula', () => {
    state().selectPage(0);
    state().selectPage(1);
    state().rotateSelectedPages(-90);
    expect(deltasOf(state())).toEqual([270, 270, 0, 0, 0]);

    state().rotatePageRange('3-4', 180);
    expect(deltasOf(state())).toEqual([270, 270, 180, 180, 0]);

    state().rotateAllPages(90);
    expect(deltasOf(state())).toEqual([0, 0, 270, 270, 90]);
    expect(finalAnglesOf(state())).toEqual([0, 90, 90, 180, 90]);
  });

  it('a bad range leaves the rotation untouched and records an error', () => {
    state().rotatePageRange('9-10', 90);
    expect(state().rangeError).toContain('超出范围');
    expect(rotatedCountOf(state())).toBe(0);
  });

  it('undo/redo walks back through repeated rotations of one page', () => {
    state().rotatePage(0, 90);
    state().rotatePage(0, 90);
    state().rotatePage(0, -90);
    expect(deltasOf(state())[0]).toBe(90);

    state().undo();
    expect(deltasOf(state())[0]).toBe(180);
    state().undo();
    expect(deltasOf(state())[0]).toBe(90);
    state().undo();
    expect(deltasOf(state())[0]).toBe(0);
    state().redo();
    expect(deltasOf(state())[0]).toBe(90);
  });

  it('a new edit drops the redo branch', () => {
    state().rotatePage(0, 90);
    state().undo();
    state().rotatePage(1, 270);
    expect(deltasOf(state())).toEqual([0, 270, 0, 0, 0]);
    state().redo();
    expect(deltasOf(state())).toEqual([0, 270, 0, 0, 0]);
  });

  it('reset restores the imported direction, not a hard 0°', () => {
    state().rotatePage(1, 90);
    state().rotatePage(3, 180);
    state().resetPage(1);
    expect(finalAnglesOf(state())[1]).toBe(90);
    state().resetAll();
    expect(deltasOf(state())).toEqual([0, 0, 0, 0, 0]);
    expect(finalAnglesOf(state())).toEqual([0, 90, 180, 270, 0]);
  });

  it('invalidates the rotated pages in the thumbnail cache, one by one', () => {
    mocks.releasePage.mockClear();
    state().rotatePage(2, 90);
    expect(mocks.releasePage).toHaveBeenCalledTimes(1);
    expect(mocks.releasePage).toHaveBeenCalledWith(state().document!.id, 3);

    mocks.releasePage.mockClear();
    state().rotateAllPages(90);
    expect(mocks.releasePage).toHaveBeenCalledTimes(5);
  });

  it('any edit invalidates a previously exported result', async () => {
    await state().startExport();
    expect(state().result).not.toBeNull();
    state().rotatePage(0, 90);
    expect(state().result).toBeNull();
    expect(state().exportStatus).toBe('idle');
  });
});

describe('export task', () => {
  beforeEach(loaded);

  it('sends final absolute angles to the engine and stores a downloadable result', async () => {
    state().rotatePage(2, 90);
    state().rotatePage(4, -90);
    await state().startExport();

    const request = mocks.rotate.mock.calls[0][0];
    expect(request.jobs).toEqual([
      { pageIndex: 0, finalAngle: 0 },
      { pageIndex: 1, finalAngle: 90 },
      { pageIndex: 2, finalAngle: 270 },
      { pageIndex: 3, finalAngle: 270 },
      { pageIndex: 4, finalAngle: 270 },
    ]);
    expect(state().exportStatus).toBe('success');
    expect(state().result?.name).toBe('report_rotated.pdf');
    expect(state().result?.verified).toBe(true);
    expect(state().result?.pageCount).toBe(5);
  });

  it('reports progress from the worker while exporting', async () => {
    let finish: (value: typeof OUTCOME) => void = () => undefined;
    mocks.rotate.mockImplementationOnce(
      (request: { onProgress?: (p: unknown) => void }) =>
        new Promise<typeof OUTCOME>((resolve) => {
          request.onProgress?.({ stage: 'applying', current: 3, total: 5 });
          finish = resolve;
        }),
    );

    const pending = state().startExport();
    await vi.waitFor(() => expect(state().progress?.current).toBe(3));
    expect(state().exportStatus).toBe('exporting');

    finish(OUTCOME);
    await pending;
    expect(state().progress).toBeNull();
    expect(state().exportStatus).toBe('success');
  });

  it('cancel leaves no result and marks the task cancelled', async () => {
    mocks.rotate.mockRejectedValueOnce(new MergeCancelledError('旋转已取消。'));
    await state().startExport();
    expect(state().exportStatus).toBe('cancelled');
    expect(state().result).toBeNull();
  });

  it('engine failure becomes an error, never a success', async () => {
    mocks.rotate.mockRejectedValueOnce(new PdfEngineError('out-of-memory', '内存不足。'));
    await state().startExport();
    expect(state().exportStatus).toBe('error');
    expect(state().error).toContain('内存不足');
    expect(state().result).toBeNull();
  });

  it('cancelExport terminates the worker and clears the result', async () => {
    await state().startExport();
    state().cancelExport();
    expect(mocks.cancel).toHaveBeenCalled();
    expect(state().exportStatus).toBe('cancelled');
    expect(state().result).toBeNull();
  });

  it('resetTask keeps the document but clears rotations, selection and result', async () => {
    state().selectPage(0);
    state().rotatePage(1, 90);
    await state().startExport();
    state().resetTask();

    expect(state().document).not.toBeNull();
    expect(deltasOf(state())).toEqual([0, 0, 0, 0, 0]);
    expect(state().document?.selectedPages).toEqual([]);
    expect(state().result).toBeNull();
    expect(mocks.terminate).toHaveBeenCalled();
  });
});

describe('cleanup and naming', () => {
  it('removing a document releases its pdf.js document and worker', async () => {
    await loaded();
    const id = state().document!.id;
    state().removeDocument();
    expect(mocks.release).toHaveBeenCalledWith(id);
    expect(mocks.terminate).toHaveBeenCalled();
    expect(state().document).toBeNull();
  });

  it('replacing a document releases the old one', async () => {
    await loaded();
    const oldId = state().document!.id;
    await state().addDocument([makeFile('new.pdf')]);
    expect(mocks.release).toHaveBeenCalledWith(oldId);
    expect(state().document?.name).toBe('new.pdf');
    expect(state().document!.id).not.toBe(oldId);
  });

  it('output names are sanitised and never overwrite the source', () => {
    expect(outputNameOf('report.pdf')).toBe('report_rotated.pdf');
    expect(outputNameOf('a/b:c.pdf')).toBe('abc_rotated.pdf');
    expect(outputNameOf('季度报告.PDF')).toBe('季度报告_rotated.pdf');
  });
});
