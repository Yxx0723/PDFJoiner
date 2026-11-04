import { create } from 'zustand';

import { LIMITS } from '@/lib/constants';
import { createId, sanitizeFileName } from '@/lib/utils';
import { MergeCancelledError, PdfEngineError } from '@/features/pdf/errors';
import { pdfEngine } from '@/features/pdf/engine-client';
import type { MergeProgress, PdfInspection } from '@/features/pdf/engine';
import { normalizeRangeInput, parsePageRange } from '@/features/page-range/parse-page-range';
import { thumbnailService } from '@/features/preview/thumbnail-service';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type FileStatus = 'reading' | 'ready' | 'error';
export type SelectionSource = 'all' | 'range' | 'custom';
export type MergeStatus = 'idle' | 'merging' | 'success' | 'error';

export interface PageSelection {
  /** Explicit ordered 0-based page indices; `null` means "every page". */
  pages: number[] | null;
  source: SelectionSource;
  /** Raw text while the user is typing, so the input stays controlled. */
  draft: string | null;
  /** Range validation message, blocks merging while present. */
  error?: string;
}

export interface PdfFileEntry {
  id: string;
  file: File;
  name: string;
  size: number;
  status: FileStatus;
  pageCount: number;
  selection: PageSelection;
  inspection?: PdfInspection;
  error?: { code: string; message: string };
  expanded: boolean;
}

export interface MergeResult {
  url: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  verified: boolean;
  durationMs: number;
}

export interface MergeState {
  status: MergeStatus;
  progress: MergeProgress | null;
  error: string | null;
  result: MergeResult | null;
  startedAt: number | null;
}

export interface ImportSummary {
  added: number;
  duplicates: string[];
  rejected: Array<{ name: string; reason: string }>;
}

export interface AppState {
  files: PdfFileEntry[];
  outputName: string;
  merge: MergeState;

  addFiles: (incoming: FileList | File[]) => Promise<ImportSummary>;
  removeFile: (id: string) => void;
  clearAll: () => void;
  moveFile: (id: string, direction: -1 | 1) => void;
  reorderFiles: (activeId: string, overId: string) => void;
  toggleExpanded: (id: string) => void;
  expandAll: (expanded: boolean) => void;
  setRangeDraft: (id: string, value: string) => void;
  resetSelection: (id: string) => void;
  togglePage: (id: string, pageIndex: number) => void;
  setOutputName: (name: string) => void;
  startMerge: () => Promise<void>;
  cancelMerge: () => void;
  resetResult: () => void;
  disposeAll: () => void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const ALL_SELECTION: PageSelection = { pages: null, source: 'all', draft: null };

function fileKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name);
}

function createEntry(file: File): PdfFileEntry {
  return {
    id: createId(),
    file,
    name: file.name,
    size: file.size,
    status: 'reading',
    pageCount: 0,
    selection: { ...ALL_SELECTION },
    expanded: false,
  };
}

export function selectedPageCount(entry: PdfFileEntry): number {
  if (entry.status !== 'ready') return 0;
  return entry.selection.pages === null ? entry.pageCount : entry.selection.pages.length;
}

function revokeResult(result: MergeResult | null): void {
  if (result?.url && typeof URL !== 'undefined') {
    URL.revokeObjectURL(result.url);
  }
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

export const useAppStore = create<AppState>()((set, get) => {
  /**
   * Bumped whenever the current task is invalidated (new merge, clear, new
   * task). Async merges compare their token before touching state, so a result
   * that arrives after "清空" can never resurrect a stale success card.
   */
  let runToken = 0;

  /** Drops any produced file once the inputs change. */
  const invalidateResult = () => {
    const { merge } = get();
    if (merge.status === 'success' || merge.status === 'error') {
      revokeResult(merge.result);
      set({ merge: { status: 'idle', progress: null, error: null, result: null, startedAt: null } });
    }
  };

  const patchEntry = (id: string, patch: Partial<PdfFileEntry>) => {
    set({ files: get().files.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)) });
  };

  const inspectEntry = async (entry: PdfFileEntry) => {
    try {
      const inspection = await pdfEngine.inspect(entry.file);
      patchEntry(entry.id, {
        status: 'ready',
        pageCount: inspection.pageCount,
        inspection,
        selection: { ...ALL_SELECTION },
        error: undefined,
      });
    } catch (error) {
      const engineError =
        error instanceof PdfEngineError
          ? error
          : new PdfEngineError('unknown', '读取该 PDF 时发生未知错误。');
      patchEntry(entry.id, {
        status: 'error',
        pageCount: 0,
        error: { code: engineError.code, message: engineError.message },
      });
    }
  };

  return {
    files: [],
    outputName: '',
    merge: { status: 'idle', progress: null, error: null, result: null, startedAt: null },

    addFiles: async (incoming) => {
      const list = Array.from(incoming);
      const summary: ImportSummary = { added: 0, duplicates: [], rejected: [] };
      const accepted: PdfFileEntry[] = [];
      const seen = new Set(get().files.map((entry) => fileKey(entry.file)));

      for (const file of list) {
        if (!isPdfName(file.name)) {
          summary.rejected.push({ name: file.name, reason: '不是 PDF 文件（扩展名必须为 .pdf）' });
          continue;
        }
        if (file.size === 0) {
          summary.rejected.push({ name: file.name, reason: '文件为空（0 字节）' });
          continue;
        }
        if (file.size > LIMITS.maxFileSizeBytes) {
          summary.rejected.push({
            name: file.name,
            reason: `超过单文件上限 ${Math.round(LIMITS.maxFileSizeBytes / 1024 / 1024)} MB`,
          });
          continue;
        }
        const key = fileKey(file);
        if (seen.has(key)) {
          summary.duplicates.push(file.name);
          continue;
        }
        if (get().files.length + accepted.length >= LIMITS.maxFiles) {
          summary.rejected.push({ name: file.name, reason: `一次最多 ${LIMITS.maxFiles} 个文件` });
          continue;
        }
        seen.add(key);
        accepted.push(createEntry(file));
      }

      if (accepted.length > 0) {
        invalidateResult();
        const merged = [...get().files, ...accepted];
        // A single imported file opens its page strip right away.
        const autoExpand = merged.length === 1;
        set({
          files: merged.map((entry) =>
            autoExpand && entry.id === accepted[0].id ? { ...entry, expanded: true } : entry,
          ),
        });
        summary.added = accepted.length;
      }

      // Inspect one by one: keeps worker memory flat and error reporting ordered.
      for (const entry of accepted) {
        await inspectEntry(entry);
      }

      return summary;
    },

    removeFile: (id) => {
      const entry = get().files.find((item) => item.id === id);
      if (!entry) return;
      invalidateResult();
      set({ files: get().files.filter((item) => item.id !== id) });
      thumbnailService.release(id);
    },

    clearAll: () => {
      runToken += 1;
      const { merge } = get();
      revokeResult(merge.result);
      set({
        files: [],
        outputName: '',
        merge: { status: 'idle', progress: null, error: null, result: null, startedAt: null },
      });
      thumbnailService.releaseAll();
      pdfEngine.cancel();
    },

    moveFile: (id, direction) => {
      const files = [...get().files];
      const index = files.findIndex((entry) => entry.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= files.length) return;
      const [moved] = files.splice(index, 1);
      files.splice(target, 0, moved);
      invalidateResult();
      set({ files });
    },

    reorderFiles: (activeId, overId) => {
      if (activeId === overId) return;
      const files = [...get().files];
      const from = files.findIndex((entry) => entry.id === activeId);
      const to = files.findIndex((entry) => entry.id === overId);
      if (from < 0 || to < 0) return;
      const [moved] = files.splice(from, 1);
      files.splice(to, 0, moved);
      invalidateResult();
      set({ files });
    },

    toggleExpanded: (id) => {
      const entry = get().files.find((item) => item.id === id);
      if (!entry) return;
      patchEntry(id, { expanded: !entry.expanded });
    },

    expandAll: (expanded) => {
      set({ files: get().files.map((entry) => ({ ...entry, expanded })) });
    },

    setRangeDraft: (id, value) => {
      const entry = get().files.find((item) => item.id === id);
      if (!entry || entry.status !== 'ready') return;

      const normalized = normalizeRangeInput(value);
      const isAll = normalized === '' || /^(all|\*|全部|全部页面|所有|所有页面)$/i.test(normalized);

      if (isAll) {
        invalidateResult();
        patchEntry(id, {
          selection: { pages: null, source: 'all', draft: value === '' ? null : value },
        });
        return;
      }

      try {
        const pages = parsePageRange(value, entry.pageCount);
        invalidateResult();
        patchEntry(id, { selection: { pages, source: 'range', draft: value } });
      } catch (error) {
        patchEntry(id, {
          selection: {
            pages: entry.selection.pages,
            source: entry.selection.source,
            draft: value,
            error: error instanceof Error ? error.message : '页码范围无效',
          },
        });
      }
    },

    resetSelection: (id) => {
      const entry = get().files.find((item) => item.id === id);
      if (!entry) return;
      invalidateResult();
      patchEntry(id, { selection: { ...ALL_SELECTION } });
    },

    togglePage: (id, pageIndex) => {
      const entry = get().files.find((item) => item.id === id);
      if (!entry || entry.status !== 'ready') return;
      if (pageIndex < 0 || pageIndex >= entry.pageCount) return;

      const current =
        entry.selection.pages ?? Array.from({ length: entry.pageCount }, (_, index) => index);
      const next = current.includes(pageIndex)
        ? current.filter((page) => page !== pageIndex)
        : [...current, pageIndex].sort((a, b) => a - b);

      invalidateResult();
      patchEntry(id, {
        selection: {
          pages: next,
          source: next.length === entry.pageCount ? 'all' : 'custom',
          draft: null,
        },
      });
    },

    setOutputName: (name) => {
      invalidateResult();
      set({ outputName: name });
    },

    startMerge: async () => {
      const state = get();
      if (state.merge.status === 'merging') return;

      const jobs = state.files
        .filter((entry) => entry.status === 'ready')
        .map((entry) => {
          const pages =
            entry.selection.pages ?? Array.from({ length: entry.pageCount }, (_, index) => index);
          return { entry, name: entry.name, pages };
        })
        .filter((job) => job.pages.length > 0);

      if (jobs.length === 0) {
        set({
          merge: {
            status: 'error',
            progress: null,
            error: '没有可合并的页面。请检查文件状态与页码范围。',
            result: null,
            startedAt: null,
          },
        });
        return;
      }

      const plans = jobs.map(({ name, pages }) => ({ name, pages }));
      revokeResult(state.merge.result);
      const startedAt = Date.now();
      const pagesTotal = jobs.reduce((sum, job) => sum + job.pages.length, 0);
      const token = (runToken += 1);

      set({
        merge: {
          status: 'merging',
          progress: {
            stage: 'loading',
            fileIndex: 0,
            fileCount: plans.length,
            fileName: plans[0].name,
            pagesDone: 0,
            pagesTotal,
          },
          error: null,
          result: null,
          startedAt,
        },
      });

      const title = sanitizeFileName(get().outputName || '合并结果').replace(/\.pdf$/i, '');

      try {
        const outcome = await pdfEngine.merge({
          files: plans,
          title,
          getBytes: async (index) => {
            const bytes = await jobs[index].entry.file.arrayBuffer();
            return new Uint8Array(bytes);
          },
          onProgress: (progress) => {
            // Ignore progress from a run that has been superseded or cleared.
            if (token !== runToken) return;
            if (get().merge.status !== 'merging') return;
            set({ merge: { ...get().merge, progress } });
          },
        });

        if (token !== runToken) return;

        const blob = new Blob([outcome.bytes.slice().buffer as ArrayBuffer], {
          type: 'application/pdf',
        });
        const url = URL.createObjectURL(blob);
        const fileName = sanitizeFileName(get().outputName || '合并结果');

        set({
          merge: {
            status: 'success',
            progress: null,
            error: null,
            startedAt,
            result: {
              url,
              fileName,
              sizeBytes: blob.size,
              pageCount: outcome.pageCount,
              verified: outcome.verified,
              durationMs: Date.now() - startedAt,
            },
          },
        });
      } catch (error) {
        if (token !== runToken) return;
        if (error instanceof MergeCancelledError || (error as { code?: string })?.code === 'cancelled') {
          set({
            merge: { status: 'idle', progress: null, error: null, result: null, startedAt: null },
          });
          return;
        }
        const message =
          error instanceof Error ? error.message : '合并失败，请重试或更换文件后重新合并。';
        set({
          merge: {
            status: 'error',
            progress: null,
            error: message,
            result: null,
            startedAt: null,
          },
        });
      }
    },

    cancelMerge: () => {
      if (get().merge.status !== 'merging') return;
      pdfEngine.cancel();
    },

    resetResult: () => {
      const { merge } = get();
      revokeResult(merge.result);
      set({ merge: { status: 'idle', progress: null, error: null, result: null, startedAt: null } });
    },

    disposeAll: () => {
      runToken += 1;
      const { merge } = get();
      revokeResult(merge.result);
      pdfEngine.terminate();
      thumbnailService.releaseAll();
      set({
        files: [],
        outputName: '',
        merge: { status: 'idle', progress: null, error: null, result: null, startedAt: null },
      });
    },
  };
});
