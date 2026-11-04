import { create } from 'zustand';

import { LIMITS } from '@/lib/constants';
import { createId } from '@/lib/utils';
import { MergeCancelledError, PdfEngineError } from '@/features/pdf/errors';
import { pdfEngine } from '@/features/pdf/engine-client';
import type { PdfInspection } from '@/features/pdf/engine';
import { splitEngine } from '@/features/pdf-split/client';
import type { SplitProgress } from '@/features/pdf-split/engine';
import { autoPrefix, buildSplitPlan } from '@/features/pdf-split/plan';
import type { NamingRule, RangeRow, SplitPlan, SplitSettings, SplitMode } from '@/features/pdf-split/types';
import { DEFAULT_CHUNK_SIZE } from '@/features/pdf-split/types';
import { normalizeRangeInput, parsePageRange } from '@/features/page-range/parse-page-range';
import { thumbnailService } from '@/features/preview/thumbnail-service';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type DocumentStatus = 'reading' | 'ready' | 'error';
export type SplitStatus = 'idle' | 'splitting' | 'success' | 'error';

export interface SplitDocument {
  id: string;
  file: File;
  name: string;
  size: number;
  pageCount: number;
  status: DocumentStatus;
  inspection?: PdfInspection;
  error?: { code: string; message: string };
  /** Ordered, 0-based pages picked in "extract" mode. */
  extractPages: number[];
  /** Raw text while typing; `null` means the input mirrors `extractPages`. */
  extractDraft: string | null;
  extractError: string | null;
  /** Editable rows for "ranges" mode. */
  rows: RangeRow[];
}

export interface SplitSettingsState {
  mode: SplitMode;
  chunkSize: number;
  naming: NamingRule;
  prefix: string;
  /** Once the user edits the prefix we stop deriving it from the file name. */
  prefixTouched: boolean;
}

export interface SplitResultFile {
  name: string;
  pages: number[];
  pageCount: number;
  sizeBytes: number;
  bytes: Uint8Array;
}

export interface SplitBuildState {
  status: SplitStatus;
  progress: SplitProgress | null;
  error: string | null;
  files: SplitResultFile[];
  verified: boolean;
  durationMs: number;
}

export interface ImportOutcome {
  /** True when the file became the current document (even if unreadable). */
  accepted: boolean;
  /** Reason to show the user: a rejection, or a document that failed to parse. */
  message?: string;
}

export interface SplitStore {
  doc: SplitDocument | null;
  settings: SplitSettingsState;
  build: SplitBuildState;

  addDocument: (incoming: FileList | File[]) => Promise<ImportOutcome>;
  removeDocument: () => void;

  setMode: (mode: SplitMode) => void;
  setChunkSize: (size: number) => void;
  setNaming: (naming: NamingRule) => void;
  setPrefix: (prefix: string) => void;
  resetPrefix: () => void;

  addRange: () => void;
  removeRange: (id: string) => void;
  setRangeText: (id: string, text: string) => void;

  toggleExtractPage: (pageIndex: number) => void;
  setExtractDraft: (text: string) => void;
  selectAllPages: () => void;
  invertSelection: () => void;
  clearSelection: () => void;

  startSplit: () => Promise<void>;
  cancelSplit: () => void;
  resetTask: () => void;
  disposeAll: () => void;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const IDLE_BUILD: SplitBuildState = {
  status: 'idle',
  progress: null,
  error: null,
  files: [],
  verified: false,
  durationMs: 0,
};

function defaultRows(pageCount: number): RangeRow[] {
  if (pageCount <= 1) return [{ id: createId(), text: '1' }];
  const half = Math.ceil(pageCount / 2);
  return [
    { id: createId(), text: `1-${half}` },
    { id: createId(), text: `${half + 1}-${pageCount}` },
  ];
}

function defaultSettings(): SplitSettingsState {
  return {
    mode: 'ranges',
    chunkSize: DEFAULT_CHUNK_SIZE,
    naming: 'index',
    prefix: 'split',
    prefixTouched: false,
  };
}

/** Settings object handed to the pure planner. */
export function splitSettingsOf(state: {
  doc: SplitDocument | null;
  settings: SplitSettingsState;
}): SplitSettings {
  const doc = state.doc;
  const prefix = state.settings.prefixTouched
    ? state.settings.prefix
    : autoPrefix(state.settings.mode, doc?.name ?? 'document');

  return {
    mode: state.settings.mode,
    ranges: doc?.rows ?? [],
    extractPages: doc?.extractPages ?? [],
    chunkSize: state.settings.chunkSize,
    prefix,
    naming: state.settings.naming,
  };
}

/** Full plan for the current document. Safe to call with no document. */
export function planOf(state: {
  doc: SplitDocument | null;
  settings: SplitSettingsState;
}): SplitPlan {
  if (!state.doc || state.doc.status !== 'ready') {
    return { outputs: [], errors: [], notes: [], rowErrors: {} };
  }
  return buildSplitPlan(state.doc.pageCount, splitSettingsOf(state));
}

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

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

export const useSplitStore = create<SplitStore>()((set, get) => {
  /** Invalidates in-flight work so late results cannot overwrite a new task. */
  let runToken = 0;

  const patchDoc = (patch: Partial<SplitDocument>) => {
    const doc = get().doc;
    if (!doc) return;
    set({ doc: { ...doc, ...patch } });
  };

  const resetBuild = () => {
    runToken += 1;
    set({ build: { ...IDLE_BUILD } });
  };

  const inspect = async (doc: SplitDocument) => {
    try {
      const inspection = await pdfEngine.inspect(doc.file);
      // The user may have replaced the file while we were reading.
      if (get().doc?.id !== doc.id) return;
      patchDoc({
        status: 'ready',
        pageCount: inspection.pageCount,
        inspection,
        error: undefined,
        rows: defaultRows(inspection.pageCount),
      });
    } catch (error) {
      if (get().doc?.id !== doc.id) return;
      const engineError = errorOf(error);
      patchDoc({
        status: 'error',
        pageCount: 0,
        error: { code: engineError.code, message: engineError.message },
      });
    }
  };

  return {
    doc: null,
    settings: defaultSettings(),
    build: { ...IDLE_BUILD },

    addDocument: async (incoming) => {
      const list = Array.from(incoming);
      if (list.length === 0) return { accepted: false };

      const [file] = list;
      if (list.length > 1) {
        return { accepted: false, message: '拆分一次只处理一个 PDF，已选用第一个文件。' };
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

      // A new document invalidates the previous one and its results.
      const previous = get().doc;
      if (previous) thumbnailService.release(previous.id);
      resetBuild();

      const doc: SplitDocument = {
        id: createId(),
        file,
        name: file.name,
        size: file.size,
        pageCount: 0,
        status: 'reading',
        extractPages: [],
        extractDraft: null,
        extractError: null,
        rows: [{ id: createId(), text: '' }],
      };

      set({ doc });
      await inspect(doc);

      // A file can be a PDF and still be unreadable (truncated, encrypted…).
      // Report that through the same channel so the UI has one code path.
      const after = get().doc;
      if (after?.status === 'error') {
        return { accepted: true, message: after.error?.message ?? '这份 PDF 无法读取。' };
      }
      return { accepted: true };
    },

    removeDocument: () => {
      const doc = get().doc;
      if (doc) thumbnailService.release(doc.id);
      resetBuild();
      set({ doc: null, settings: { ...get().settings, prefixTouched: false } });
    },

    setMode: (mode) => {
      set({ settings: { ...get().settings, mode } });
      resetBuild();
    },

    setChunkSize: (size) => {
      const clamped = Math.min(
        Math.max(1, Math.round(Number(size) || 1)),
        LIMITS.maxSplitChunkSize,
      );
      set({ settings: { ...get().settings, chunkSize: clamped } });
      resetBuild();
    },

    setNaming: (naming) => {
      set({ settings: { ...get().settings, naming } });
      resetBuild();
    },

    setPrefix: (prefix) => {
      set({ settings: { ...get().settings, prefix, prefixTouched: true } });
      resetBuild();
    },

    resetPrefix: () => {
      set({ settings: { ...get().settings, prefixTouched: false } });
      resetBuild();
    },

    addRange: () => {
      const doc = get().doc;
      if (!doc) return;
      if (doc.rows.length >= 100) return;
      set({ doc: { ...doc, rows: [...doc.rows, { id: createId(), text: '' }] } });
      resetBuild();
    },

    removeRange: (id) => {
      const doc = get().doc;
      if (!doc) return;
      // Keep at least one row so the editor never collapses to nothing.
      if (doc.rows.length <= 1) {
        set({ doc: { ...doc, rows: [{ id: createId(), text: '' }] } });
      } else {
        set({ doc: { ...doc, rows: doc.rows.filter((row) => row.id !== id) } });
      }
      resetBuild();
    },

    setRangeText: (id, text) => {
      const doc = get().doc;
      if (!doc) return;
      set({
        doc: { ...doc, rows: doc.rows.map((row) => (row.id === id ? { ...row, text } : row)) },
      });
      resetBuild();
    },

    toggleExtractPage: (pageIndex) => {
      const doc = get().doc;
      if (!doc) return;
      const present = doc.extractPages.includes(pageIndex);
      const next = present
        ? doc.extractPages.filter((page) => page !== pageIndex)
        : [...doc.extractPages, pageIndex];

      // Clicking a thumbnail is authoritative: drop any half-typed expression.
      set({
        doc: { ...doc, extractPages: next, extractDraft: null, extractError: null },
      });
      resetBuild();
    },

    setExtractDraft: (text) => {
      const doc = get().doc;
      if (!doc) return;

      if (normalizeRangeInput(text).length === 0) {
        set({ doc: { ...doc, extractDraft: text, extractPages: [], extractError: null } });
        resetBuild();
        return;
      }

      try {
        const pages = parsePageRange(text, doc.pageCount);
        set({ doc: { ...doc, extractDraft: text, extractPages: pages, extractError: null } });
      } catch (error) {
        // Keep the previous (valid) selection: the user is mid-edit.
        const message =
          error instanceof Error ? error.message : '这个页码范围无法解析，请检查格式。';
        set({ doc: { ...doc, extractDraft: text, extractError: message } });
      }
      resetBuild();
    },

    selectAllPages: () => {
      const doc = get().doc;
      if (!doc) return;
      set({
        doc: {
          ...doc,
          extractPages: Array.from({ length: doc.pageCount }, (_, index) => index),
          extractDraft: null,
          extractError: null,
        },
      });
      resetBuild();
    },

    invertSelection: () => {
      const doc = get().doc;
      if (!doc) return;
      const chosen = new Set(doc.extractPages);
      set({
        doc: {
          ...doc,
          extractPages: Array.from({ length: doc.pageCount }, (_, index) => index).filter(
            (page) => !chosen.has(page),
          ),
          extractDraft: null,
          extractError: null,
        },
      });
      resetBuild();
    },

    clearSelection: () => {
      const doc = get().doc;
      if (!doc) return;
      set({ doc: { ...doc, extractPages: [], extractDraft: '', extractError: null } });
      resetBuild();
    },

    startSplit: async () => {
      const { doc } = get();
      if (!doc || doc.status !== 'ready') return;
      if (get().build.status === 'splitting') return;

      const plan = planOf(get());
      if (plan.errors.length > 0) {
        set({ build: { ...IDLE_BUILD, status: 'error', error: plan.errors[0] } });
        return;
      }
      if (plan.outputs.length === 0) {
        set({ build: { ...IDLE_BUILD, status: 'error', error: '没有可输出的文件。' } });
        return;
      }

      const token = (runToken += 1);
      const startedAt = Date.now();
      set({
        build: {
          status: 'splitting',
          progress: {
            stage: 'loading',
            outputIndex: 0,
            outputCount: plan.outputs.length,
            outputName: plan.outputs[0].name,
            pagesDone: 0,
            pagesTotal: plan.outputs.reduce((sum, output) => sum + output.pages.length, 0),
          },
          error: null,
          files: [],
          verified: false,
          durationMs: 0,
        },
      });

      try {
        const bytes = new Uint8Array(await doc.file.arrayBuffer());

        const outcome = await splitEngine.split({
          bytes,
          jobs: plan.outputs.map((output) => ({ name: output.name, pages: output.pages })),
          onProgress: (progress) => {
            if (token !== runToken) return;
            if (get().build.status !== 'splitting') return;
            set({ build: { ...get().build, progress } });
          },
        });

        if (token !== runToken) return;

        const files: SplitResultFile[] = outcome.files.map((file) => ({
          name: file.name,
          pages: file.pages,
          pageCount: file.pageCount,
          sizeBytes: file.bytes.byteLength,
          bytes: file.bytes,
        }));

        set({
          build: {
            status: 'success',
            progress: null,
            error: null,
            files,
            verified: outcome.verified,
            durationMs: Date.now() - startedAt,
          },
        });
      } catch (error) {
        if (token !== runToken) return;

        if (error instanceof MergeCancelledError || (error as { code?: string })?.code === 'cancelled') {
          set({ build: { ...IDLE_BUILD } });
          return;
        }

        const message =
          error instanceof Error ? error.message : '拆分失败，请重试或更换文件。';
        set({ build: { ...IDLE_BUILD, status: 'error', error: message } });
      }
    },

    cancelSplit: () => {
      splitEngine.cancel();
      runToken += 1;
      set({ build: { ...IDLE_BUILD } });
    },

    resetTask: () => {
      resetBuild();
      const doc = get().doc;
      if (!doc) return;
      set({
        doc: {
          ...doc,
          extractPages: [],
          extractDraft: null,
          extractError: null,
          rows: defaultRows(doc.pageCount),
        },
        settings: {
          ...get().settings,
          mode: 'ranges',
          chunkSize: DEFAULT_CHUNK_SIZE,
          naming: 'index',
          prefixTouched: false,
        },
      });
    },

    disposeAll: () => {
      runToken += 1;
      splitEngine.terminate();
      const doc = get().doc;
      if (doc) thumbnailService.release(doc.id);
      set({ doc: null, settings: defaultSettings(), build: { ...IDLE_BUILD } });
    },
  };
});

/* -------------------------------------------------------------------------- */
/* Selectors                                                                   */
/* -------------------------------------------------------------------------- */

/** 1-based page numbers currently selected in extract mode. */
export function extractPageNumbers(doc: SplitDocument | null): number[] {
  return (doc?.extractPages ?? []).map((page) => page + 1);
}

/** Value shown in the extract range input. */
export function extractInputValue(doc: SplitDocument | null): string {
  if (!doc) return '';
  if (doc.extractDraft !== null) return doc.extractDraft;
  return doc.extractPages.map((page) => page + 1).join(',');
}
