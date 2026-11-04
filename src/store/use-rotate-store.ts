/**
 * Zustand store for the PDF rotation tool (V1.3 / P2).
 *
 * The single source of truth for rotation is `history.entries[history.index]`
 * — an array of **deltas** relative to the imported document. Final angles are
 * always derived as `finalRotation(originalRotations[i], deltas[i])`, both by
 * the thumbnails and by the export job, so the UI can never disagree with the
 * file that is written.
 *
 * Async work uses `runToken`: after a cancel, a file replacement or a settings
 * change, a late worker result cannot overwrite the current state.
 */

import { create } from 'zustand';

import { LIMITS } from '@/lib/constants';
import { createId, sanitizeFileName } from '@/lib/utils';
import type { PdfInspection } from '@/features/pdf/engine';
import { MergeCancelledError, PdfEngineError } from '@/features/pdf/errors';
import { rotateEngine } from '@/features/pdf-rotate/client';
import {
  createHistory,
  currentDeltas,
  pushHistory,
  redoHistory,
  undoHistory,
  type RotationHistory,
} from '@/features/pdf-rotate/history';
import {
  buildRotationJobs,
  finalRotation,
  resetDeltas,
  rotateDeltas,
} from '@/features/pdf-rotate/rotation';
import type {
  RotateExportStatus,
  RotateProgress,
  RotateScope,
  RotationAngle,
  RotationJob,
} from '@/features/pdf-rotate/types';
import { parsePageRange } from '@/features/page-range/parse-page-range';
import { thumbnailService } from '@/features/preview/thumbnail-service';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type RotateDocumentStatus = 'reading' | 'ready' | 'error';

export interface RotateDocument {
  id: string;
  file: File;
  name: string;
  size: number;
  pageCount: number;
  status: RotateDocumentStatus;
  error?: { code: string; message: string };
  /** `/Rotate` of every page, read from the real PDF at import time. */
  originalRotations: RotationAngle[];
  inspection?: PdfInspection;
  /** 0-based, sorted, unique. */
  selectedPages: number[];
}

export interface RotateResult {
  name: string;
  bytes: Uint8Array;
  sizeBytes: number;
  pageCount: number;
  rotations: RotationAngle[];
  verified: boolean;
  durationMs: number;
}

export interface ImportOutcome {
  accepted: boolean;
  message?: string;
}

export interface ScopeResolution {
  indices: number[];
  label: string;
  error: string | null;
}

export interface RotateState {
  document: RotateDocument | null;
  history: RotationHistory;
  scope: RotateScope;
  /** 1-based page currently shown in the large preview. */
  currentPage: number;
  rangeDraft: string;
  rangeError: string | null;
  exportStatus: RotateExportStatus;
  progress: RotateProgress | null;
  error: string | null;
  result: RotateResult | null;

  addDocument: (incoming: FileList | File[]) => Promise<ImportOutcome>;
  removeDocument: () => void;

  selectPage: (pageIndex: number) => void;
  selectAllPages: () => void;
  invertSelection: () => void;
  clearSelection: () => void;

  setScope: (scope: RotateScope) => void;
  setCurrentPage: (page: number) => void;
  setRangeDraft: (text: string) => void;

  rotatePage: (pageIndex: number, delta: number) => void;
  rotateSelectedPages: (delta: number) => void;
  rotatePageRange: (text: string, delta: number) => void;
  rotateAllPages: (delta: number) => void;
  rotateBy: (delta: number, scope?: RotateScope) => void;

  undo: () => void;
  redo: () => void;
  resetPage: (pageIndex: number) => void;
  resetAll: () => void;

  startExport: () => Promise<void>;
  cancelExport: () => void;
  resetTask: () => void;
  disposeAll: () => void;
}

/* -------------------------------------------------------------------------- */
/* Pure selectors                                                              */
/* -------------------------------------------------------------------------- */

const IDLE_BUILD = {
  exportStatus: 'idle' as RotateExportStatus,
  progress: null as RotateProgress | null,
  error: null as string | null,
  result: null as RotateResult | null,
};

function freshHistory(deltas: number[] = []): RotationHistory {
  return createHistory(deltas, LIMITS.rotateHistoryLimit);
}

function zeros(count: number): RotationAngle[] {
  return Array.from({ length: count }, () => 0 as RotationAngle);
}

/** Current per-page deltas. Snapshots are written only by `rotateDeltas`. */
export function deltasOf(state: Pick<RotateState, 'history'>): RotationAngle[] {
  return currentDeltas(state.history) as RotationAngle[];
}

/** Final absolute angles — exactly what the export writes and previews show. */
export function finalAnglesOf(state: Pick<RotateState, 'history' | 'document'>): RotationAngle[] {
  const doc = state.document;
  if (!doc) return [];
  const deltas = deltasOf(state);
  return doc.originalRotations.map((original, index) =>
    finalRotation(original, deltas[index] ?? 0),
  );
}

export function rotatedCountOf(state: Pick<RotateState, 'history'>): number {
  return deltasOf(state).filter((delta) => delta !== 0).length;
}

export function outputNameOf(name: string): string {
  return sanitizeFileName(`${name.replace(/\.pdf$/i, '')}_rotated`, 'rotated');
}

/** Resolves the four operation scopes to concrete, de-duplicated page indices. */
export function resolveScope(
  state: Pick<RotateState, 'document' | 'scope' | 'currentPage' | 'rangeDraft'>,
  scope: RotateScope = state.scope,
): ScopeResolution {
  const doc = state.document;
  if (!doc || doc.status !== 'ready') {
    return { indices: [], label: '未载入 PDF', error: '请先载入一份 PDF。' };
  }
  const count = doc.pageCount;

  switch (scope) {
    case 'page': {
      const index = state.currentPage - 1;
      if (index < 0 || index >= count) {
        return { indices: [], label: '当前页', error: '当前页无效，请在预览中选择页面。' };
      }
      return { indices: [index], label: `第 ${state.currentPage} 页`, error: null };
    }
    case 'selected': {
      const pages = doc.selectedPages;
      if (pages.length === 0) {
        return { indices: [], label: '已选页面', error: '还没有勾选任何页面。' };
      }
      return { indices: [...pages], label: `已选 ${pages.length} 页`, error: null };
    }
    case 'range': {
      try {
        const parsed = parsePageRange(state.rangeDraft, count);
        const indices = [...new Set(parsed)].sort((a, b) => a - b);
        return { indices, label: `范围内 ${indices.length} 页`, error: null };
      } catch (error) {
        return {
          indices: [],
          label: '页码范围',
          error: error instanceof Error ? error.message : '页码范围无法解析。',
        };
      }
    }
    case 'all':
      return {
        indices: Array.from({ length: count }, (_, index) => index),
        label: `全部 ${count} 页`,
        error: null,
      };
    default:
      return { indices: [], label: '', error: '未知的旋转范围。' };
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name);
}

/** Real PDFs start with `%PDF-`; readers tolerate a little leading junk. */
async function looksLikePdf(file: File): Promise<boolean> {
  const head = await file.slice(0, 1024).text();
  return head.includes('%PDF-');
}

function errorOf(error: unknown): PdfEngineError {
  if (error instanceof PdfEngineError) return error;
  return new PdfEngineError('unknown', '读取该 PDF 时发生未知错误，请重试或更换文件。');
}

function pageIndices(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, index) => index);
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

export const useRotateStore = create<RotateState>()((set, get) => {
  /** Invalidates in-flight work so late results cannot overwrite a new task. */
  let runToken = 0;

  const patchDoc = (patch: Partial<RotateDocument>) => {
    const doc = get().document;
    if (!doc) return;
    set({ document: { ...doc, ...patch } });
  };

  const invalidatePages = (indices: number[]) => {
    const doc = get().document;
    if (!doc) return;
    for (const index of indices) thumbnailService.releasePage(doc.id, index + 1);
  };

  /** Every rotation edit goes through here: history, cache, result invalidation. */
  const commitDeltas = (next: RotationAngle[], affected: number[]) => {
    const history = pushHistory(get().history, next);
    if (history === get().history) return;
    invalidatePages(affected);
    runToken += 1;
    set({ history, ...IDLE_BUILD });
  };

  const apply = (indices: number[], delta: number) => {
    if (indices.length === 0) return;
    commitDeltas(rotateDeltas(deltasOf(get()), indices, delta), indices);
  };

  const moveHistory = (direction: 'undo' | 'redo') => {
    const before = deltasOf(get());
    const history = direction === 'undo' ? undoHistory(get().history) : redoHistory(get().history);
    if (history === get().history) return;
    const after = currentDeltas(history);
    const changed = after
      .map((value, index) => (value !== before[index] ? index : -1))
      .filter((index) => index >= 0);
    invalidatePages(changed);
    runToken += 1;
    set({ history, ...IDLE_BUILD });
  };

  return {
    document: null,
    history: freshHistory([]),
    scope: 'all',
    currentPage: 1,
    rangeDraft: '',
    rangeError: null,
    ...IDLE_BUILD,

    addDocument: async (incoming) => {
      const list = Array.from(incoming);
      if (list.length === 0) return { accepted: false };

      const [file] = list;
      if (list.length > 1) {
        return { accepted: false, message: '旋转一次只处理一个 PDF，已选用第一个文件。' };
      }
      if (!isPdfName(file.name)) {
        return { accepted: false, message: '不是 PDF 文件（扩展名必须为 .pdf）。' };
      }
      if (file.size === 0) {
        return { accepted: false, message: '文件为空（0 字节）。' };
      }
      if (file.size > LIMITS.maxFileSizeBytes) {
        return {
          accepted: false,
          message: `超过单文件上限 ${Math.round(LIMITS.maxFileSizeBytes / 1024 / 1024)} MB。`,
        };
      }
      if (!(await looksLikePdf(file))) {
        return { accepted: false, message: '文件内容不是 PDF（可能只是改了扩展名）。' };
      }

      const previous = get().document;
      if (previous) thumbnailService.release(previous.id);
      runToken += 1;

      const doc: RotateDocument = {
        id: createId(),
        file,
        name: file.name,
        size: file.size,
        pageCount: 0,
        status: 'reading',
        originalRotations: [],
        selectedPages: [],
      };

      set({
        document: doc,
        history: freshHistory([]),
        scope: 'all',
        currentPage: 1,
        rangeDraft: '',
        rangeError: null,
        ...IDLE_BUILD,
      });

      try {
        const facts = await rotateEngine.inspect(file);
        // The user may have replaced the file while we were reading it.
        if (get().document?.id !== doc.id) return { accepted: true };
        patchDoc({
          status: 'ready',
          pageCount: facts.pageCount,
          originalRotations: facts.rotations,
          inspection: facts.inspection,
          error: undefined,
        });
        set({ history: freshHistory(zeros(facts.pageCount)) });
        return { accepted: true };
      } catch (error) {
        if (get().document?.id !== doc.id) return { accepted: true };
        const engineError = errorOf(error);
        patchDoc({
          status: 'error',
          pageCount: 0,
          error: { code: engineError.code, message: engineError.message },
        });
        return { accepted: true, message: engineError.message };
      }
    },

    removeDocument: () => {
      const doc = get().document;
      if (doc) thumbnailService.release(doc.id);
      runToken += 1;
      rotateEngine.terminate();
      set({
        document: null,
        history: freshHistory([]),
        scope: 'all',
        currentPage: 1,
        rangeDraft: '',
        rangeError: null,
        ...IDLE_BUILD,
      });
    },

    selectPage: (pageIndex) => {
      const doc = get().document;
      if (!doc || pageIndex < 0 || pageIndex >= doc.pageCount) return;
      const chosen = new Set(doc.selectedPages);
      if (chosen.has(pageIndex)) chosen.delete(pageIndex);
      else chosen.add(pageIndex);
      patchDoc({ selectedPages: [...chosen].sort((a, b) => a - b) });
    },

    selectAllPages: () => {
      const doc = get().document;
      if (!doc) return;
      patchDoc({ selectedPages: pageIndices(doc.pageCount) });
    },

    invertSelection: () => {
      const doc = get().document;
      if (!doc) return;
      const chosen = new Set(doc.selectedPages);
      patchDoc({
        selectedPages: pageIndices(doc.pageCount).filter((page) => !chosen.has(page)),
      });
    },

    clearSelection: () => patchDoc({ selectedPages: [] }),

    setScope: (scope) => set({ scope }),

    setCurrentPage: (page) => {
      const doc = get().document;
      if (!doc) return;
      set({ currentPage: Math.min(Math.max(1, Math.round(page) || 1), doc.pageCount) });
    },

    setRangeDraft: (text) => {
      set({ rangeDraft: text });
      const doc = get().document;
      if (!doc || doc.status !== 'ready') {
        set({ rangeError: null });
        return;
      }
      try {
        parsePageRange(text, doc.pageCount);
        set({ rangeError: null });
      } catch (error) {
        set({ rangeError: error instanceof Error ? error.message : '页码范围无法解析。' });
      }
    },

    rotatePage: (pageIndex, delta) => apply([pageIndex], delta),

    rotateSelectedPages: (delta) => apply(get().document?.selectedPages ?? [], delta),

    rotatePageRange: (text, delta) => {
      const doc = get().document;
      if (!doc) return;
      try {
        const parsed = parsePageRange(text, doc.pageCount);
        set({ rangeDraft: text, rangeError: null });
        apply([...new Set(parsed)], delta);
      } catch (error) {
        set({ rangeDraft: text, rangeError: error instanceof Error ? error.message : '页码范围无法解析。' });
      }
    },

    rotateAllPages: (delta) => apply(pageIndices(get().document?.pageCount ?? 0), delta),

    rotateBy: (delta, scope) => {
      const resolution = resolveScope(get(), scope);
      if (resolution.error || resolution.indices.length === 0) return;
      apply(resolution.indices, delta);
    },

    undo: () => moveHistory('undo'),
    redo: () => moveHistory('redo'),

    resetPage: (pageIndex) => {
      const before = deltasOf(get());
      const next = resetDeltas(before, [pageIndex]);
      commitDeltas(next, [pageIndex]);
    },

    resetAll: () => {
      const indices = pageIndices(get().document?.pageCount ?? 0);
      commitDeltas(resetDeltas(deltasOf(get()), indices), indices);
    },

    startExport: async () => {
      const { document: doc, exportStatus } = get();
      if (!doc || doc.status !== 'ready' || exportStatus === 'exporting') return;

      let jobs: RotationJob[];
      try {
        jobs = buildRotationJobs(doc.originalRotations, deltasOf(get()));
      } catch (error) {
        set({
          exportStatus: 'error',
          progress: null,
          error: error instanceof Error ? error.message : '旋转状态不一致，请重新载入 PDF。',
          result: null,
        });
        return;
      }

      const token = (runToken += 1);
      const startedAt = Date.now();
      set({
        exportStatus: 'exporting',
        progress: { stage: 'loading', current: 0, total: doc.pageCount },
        error: null,
        result: null,
      });

      try {
        const bytes = new Uint8Array(await doc.file.arrayBuffer());
        const outcome = await rotateEngine.rotate({
          bytes,
          jobs,
          onProgress: (progress) => {
            if (token !== runToken || get().exportStatus !== 'exporting') return;
            set({ progress });
          },
        });

        if (token !== runToken) return;
        set({
          exportStatus: 'success',
          progress: null,
          error: null,
          result: {
            name: outputNameOf(doc.name),
            bytes: outcome.bytes,
            sizeBytes: outcome.bytes.byteLength,
            pageCount: outcome.pageCount,
            rotations: outcome.rotations,
            verified: outcome.verified,
            durationMs: Date.now() - startedAt,
          },
        });
      } catch (error) {
        if (token !== runToken) return;
        if (error instanceof MergeCancelledError || (error as { code?: string })?.code === 'cancelled') {
          set({ exportStatus: 'cancelled', progress: null, error: null, result: null });
          return;
        }
        set({
          exportStatus: 'error',
          progress: null,
          error: error instanceof Error ? error.message : '导出失败，请重试或更换文件。',
          result: null,
        });
      }
    },

    cancelExport: () => {
      rotateEngine.cancel();
      runToken += 1;
      set({ exportStatus: 'cancelled', progress: null, error: null, result: null });
    },

    resetTask: () => {
      const doc = get().document;
      runToken += 1;
      rotateEngine.terminate();
      set({
        history: freshHistory(zeros(doc?.pageCount ?? 0)),
        scope: 'all',
        currentPage: 1,
        rangeDraft: '',
        rangeError: null,
        ...IDLE_BUILD,
      });
      if (doc) patchDoc({ selectedPages: [] });
    },

    disposeAll: () => {
      runToken += 1;
      rotateEngine.terminate();
      const doc = get().document;
      if (doc) thumbnailService.release(doc.id);
      set({
        document: null,
        history: freshHistory([]),
        scope: 'all',
        currentPage: 1,
        rangeDraft: '',
        rangeError: null,
        ...IDLE_BUILD,
      });
    },
  };
});
