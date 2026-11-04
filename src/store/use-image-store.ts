/**
 * State for the images → PDF tool.
 *
 * Deliberately parallel to `use-app-store` (the PDF merge tool): same import
 * summary shape, same progress/result lifecycle, same "invalidate on mutation"
 * rule. Keeping them separate means switching tools never mixes two documents
 * into one task.
 */

import { create } from 'zustand';

import { LIMITS } from '@/lib/constants';
import { createId, sanitizeFileName } from '@/lib/utils';
import { imageEngine } from '@/features/image-pdf/client';
import { ImagePdfCancelledError, ImagePdfError } from '@/features/image-pdf/errors';
import { inspectImageFile } from '@/features/image-pdf/inspect';
import {
  DEFAULT_SETTINGS,
  type ImageJob,
  type ImagePdfProgress,
  type ImagePdfSettings,
  type ImageFormat,
  type PageSummary,
  type Rotation,
} from '@/features/image-pdf/types';

export type ImageStatus = 'reading' | 'ready' | 'error';
export type ImageBuildStatus = 'idle' | 'building' | 'success' | 'error';

export interface ImageEntry {
  id: string;
  file: File;
  name: string;
  size: number;
  status: ImageStatus;
  /** Natural pixel size, before user rotation. */
  width: number;
  height: number;
  format: ImageFormat;
  hasAlpha: boolean;
  rotation: Rotation;
  /** Object URL used for the card thumbnail; revoked when the entry goes away. */
  previewUrl: string;
  error?: { code: string; message: string };
}

export interface ImageResult {
  url: string;
  blob: Blob;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  verified: boolean;
  durationMs: number;
  pages: PageSummary[];
}

export interface ImageBuildState {
  status: ImageBuildStatus;
  progress: ImagePdfProgress | null;
  error: string | null;
  result: ImageResult | null;
  startedAt: number | null;
}

export interface ImageImportSummary {
  added: number;
  duplicates: string[];
  rejected: Array<{ name: string; reason: string }>;
}

export interface ImagePdfStore {
  images: ImageEntry[];
  settings: ImagePdfSettings;
  build: ImageBuildState;
  activeId: string | null;

  addImages: (incoming: FileList | File[]) => Promise<ImageImportSummary>;
  removeImage: (id: string) => void;
  clearAll: () => void;
  moveImage: (id: string, direction: -1 | 1) => void;
  reorderImages: (activeId: string, overId: string) => void;
  rotateImage: (id: string, direction: -1 | 1) => void;
  resetRotation: (id: string) => void;
  setActive: (id: string | null) => void;
  setSettings: (patch: Partial<ImagePdfSettings>) => void;
  startBuild: () => Promise<void>;
  cancelBuild: () => void;
  resetResult: () => void;
  disposeAll: () => void;
}

const IDLE_BUILD: ImageBuildState = {
  status: 'idle',
  progress: null,
  error: null,
  result: null,
  startedAt: null,
};

function fileKey(file: File): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

export function readyImages(images: ImageEntry[]): ImageEntry[] {
  return images.filter((entry) => entry.status === 'ready');
}

export function toJob(entry: ImageEntry): ImageJob {
  return {
    id: entry.id,
    name: entry.name,
    file: entry.file,
    format: entry.format,
    width: entry.width,
    height: entry.height,
    rotation: entry.rotation,
    hasAlpha: entry.hasAlpha,
  };
}

function revoke(url: string | undefined): void {
  if (url && typeof URL !== 'undefined') URL.revokeObjectURL(url);
}

function nextRotation(current: Rotation, direction: -1 | 1): Rotation {
  const step = direction === 1 ? 90 : 270;
  return ((current + step) % 360) as Rotation;
}

export const useImageStore = create<ImagePdfStore>()((set, get) => {
  /** Guards against a late worker result resurrecting a cleared task. */
  let runToken = 0;

  const invalidateResult = () => {
    const { build } = get();
    if (build.status === 'success' || build.status === 'error') {
      revoke(build.result?.url);
      set({ build: { ...IDLE_BUILD } });
    }
  };

  const patchImage = (id: string, patch: Partial<ImageEntry>) => {
    set({
      images: get().images.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });
  };

  return {
    images: [],
    settings: { ...DEFAULT_SETTINGS },
    build: { ...IDLE_BUILD },
    activeId: null,

    addImages: async (incoming) => {
      const list = Array.from(incoming);
      const summary: ImageImportSummary = { added: 0, duplicates: [], rejected: [] };
      const accepted: ImageEntry[] = [];
      const seen = new Set(get().images.map((entry) => fileKey(entry.file)));

      for (const file of list) {
        if (file.size === 0) {
          summary.rejected.push({ name: file.name, reason: '文件为空（0 字节）' });
          continue;
        }
        if (file.size > LIMITS.maxImageFileSizeBytes) {
          summary.rejected.push({
            name: file.name,
            reason: `超过单张图片上限 ${Math.round(LIMITS.maxImageFileSizeBytes / 1024 / 1024)} MB`,
          });
          continue;
        }
        const key = fileKey(file);
        if (seen.has(key)) {
          summary.duplicates.push(file.name);
          continue;
        }
        if (get().images.length + accepted.length >= LIMITS.maxImageCount) {
          summary.rejected.push({
            name: file.name,
            reason: `一次最多 ${LIMITS.maxImageCount} 张图片`,
          });
          continue;
        }
        seen.add(key);
        accepted.push({
          id: createId(),
          file,
          name: file.name,
          size: file.size,
          status: 'reading',
          width: 0,
          height: 0,
          format: 'unknown',
          hasAlpha: false,
          rotation: 0,
          previewUrl: URL.createObjectURL(file),
        });
      }

      if (accepted.length === 0) return summary;

      invalidateResult();
      set({
        images: [...get().images, ...accepted],
        activeId: get().activeId ?? accepted[0].id,
      });
      summary.added = accepted.length;

      // Inspect sequentially: decoding keeps at most one bitmap alive at a time.
      for (const entry of accepted) {
        try {
          const inspection = await inspectImageFile(entry.file);
          patchImage(entry.id, {
            status: 'ready',
            width: inspection.width,
            height: inspection.height,
            format: inspection.format,
            hasAlpha: inspection.hasAlpha,
            error: undefined,
          });
        } catch (error) {
          const engineError =
            error instanceof ImagePdfError
              ? error
              : new ImagePdfError('unknown', '读取这张图片时发生未知错误。');
          // Drop the preview URL: a broken card shows no thumbnail, so keeping
          // the blob alive would only waste memory.
          revoke(entry.previewUrl);
          patchImage(entry.id, {
            status: 'error',
            previewUrl: '',
            error: { code: engineError.code, message: engineError.message },
          });
        }
      }

      return summary;
    },

    removeImage: (id) => {
      const entry = get().images.find((item) => item.id === id);
      if (!entry) return;
      invalidateResult();
      revoke(entry.previewUrl);
      const images = get().images.filter((item) => item.id !== id);
      set({
        images,
        activeId: get().activeId === id ? (images[0]?.id ?? null) : get().activeId,
      });
    },

    clearAll: () => {
      runToken += 1;
      const { build, images } = get();
      revoke(build.result?.url);
      for (const entry of images) revoke(entry.previewUrl);
      set({ images: [], build: { ...IDLE_BUILD }, activeId: null });
      imageEngine.cancel();
    },

    moveImage: (id, direction) => {
      const images = [...get().images];
      const index = images.findIndex((entry) => entry.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= images.length) return;
      const [moved] = images.splice(index, 1);
      images.splice(target, 0, moved);
      invalidateResult();
      set({ images });
    },

    reorderImages: (activeId, overId) => {
      if (activeId === overId) return;
      const images = [...get().images];
      const from = images.findIndex((entry) => entry.id === activeId);
      const to = images.findIndex((entry) => entry.id === overId);
      if (from < 0 || to < 0) return;
      const [moved] = images.splice(from, 1);
      images.splice(to, 0, moved);
      invalidateResult();
      set({ images });
    },

    rotateImage: (id, direction) => {
      const entry = get().images.find((item) => item.id === id);
      if (!entry) return;
      invalidateResult();
      patchImage(id, { rotation: nextRotation(entry.rotation, direction) });
    },

    resetRotation: (id) => {
      invalidateResult();
      patchImage(id, { rotation: 0 });
    },

    setActive: (id) => set({ activeId: id }),

    setSettings: (patch) => {
      // Renaming the output does not change the PDF that was produced, so it must
      // not throw away the result card.
      const onlyName = Object.keys(patch).every((key) => key === 'outputName');
      if (!onlyName) invalidateResult();
      set({ settings: { ...get().settings, ...patch } });
    },

    startBuild: async () => {
      const state = get();
      if (state.build.status === 'building') return;

      const images = readyImages(state.images);
      if (images.length === 0) {
        set({
          build: {
            ...IDLE_BUILD,
            status: 'error',
            error: '没有可转换的图片。请先导入 JPG、PNG、WebP、BMP 或 GIF。',
          },
        });
        return;
      }

      revoke(state.build.result?.url);
      const startedAt = Date.now();
      const token = (runToken += 1);
      const jobs = images.map(toJob);
      const settings = state.settings;

      set({
        build: {
          status: 'building',
          progress: { phase: 'encoding', done: 0, total: jobs.length, fileName: jobs[0].name },
          error: null,
          result: null,
          startedAt,
        },
      });

      try {
        const outcome = await imageEngine.build({
          jobs,
          settings,
          onProgress: (progress) => {
            if (token !== runToken) return;
            if (get().build.status !== 'building') return;
            set({ build: { ...get().build, progress } });
          },
        });

        if (token !== runToken) return;

        const blob = new Blob([outcome.bytes.slice().buffer as ArrayBuffer], {
          type: 'application/pdf',
        });
        const url = URL.createObjectURL(blob);

        set({
          build: {
            status: 'success',
            progress: null,
            error: null,
            startedAt,
            result: {
              url,
              blob,
              fileName: sanitizeFileName(get().settings.outputName || '图片合集'),
              sizeBytes: blob.size,
              pageCount: outcome.pageCount,
              verified: outcome.verified,
              durationMs: Date.now() - startedAt,
              pages: outcome.pages,
            },
          },
        });
      } catch (error) {
        if (token !== runToken) return;
        if (
          error instanceof ImagePdfCancelledError ||
          (error as { code?: string })?.code === 'cancelled'
        ) {
          set({ build: { ...IDLE_BUILD } });
          return;
        }
        set({
          build: {
            ...IDLE_BUILD,
            status: 'error',
            error:
              error instanceof Error ? error.message : '生成失败，请重试或更换图片后重新生成。',
          },
        });
      }
    },

    cancelBuild: () => {
      if (get().build.status !== 'building') return;
      imageEngine.cancel();
    },

    resetResult: () => {
      revoke(get().build.result?.url);
      set({ build: { ...IDLE_BUILD } });
    },

    disposeAll: () => {
      runToken += 1;
      const { build, images } = get();
      revoke(build.result?.url);
      for (const entry of images) revoke(entry.previewUrl);
      imageEngine.terminate();
      set({
        images: [],
        build: { ...IDLE_BUILD },
        activeId: null,
        settings: { ...DEFAULT_SETTINGS },
      });
    },
  };
});

/** Total page count the next build would produce (one page per ready image). */
export function imageOutputPages(images: ImageEntry[]): number {
  return readyImages(images).length;
}
