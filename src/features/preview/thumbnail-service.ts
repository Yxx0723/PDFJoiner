/**
 * Lazy PDF.js thumbnail service.
 *
 * Design notes
 * ------------
 * - pdf.js itself is imported dynamically, so the ~1 MB library is only fetched
 *   after the user actually opens a page preview.
 * - Every document is keyed by the app-level file id, so removing a file can
 *   release its pdf.js document (and the memory behind it) deterministically.
 * - Rendering is throttled by a semaphore (`thumbnailConcurrency`) and results
 *   are memoised in an LRU so scrolling a 500-page document does not melt the
 *   main thread.
 */

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { LIMITS } from '@/lib/constants';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type PdfJsModule = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((module) => {
      module.GlobalWorkerOptions.workerSrc = workerUrl;
      return module;
    });
  }
  return pdfjsPromise;
}

interface DocumentEntry {
  promise: Promise<{ doc: PDFDocumentProxy; task: PDFDocumentLoadingTask }>;
  disposed: boolean;
}

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}

export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

export class ThumbnailService {
  private readonly documents = new Map<string, DocumentEntry>();
  private readonly cache = new Map<string, Thumbnail>();
  private readonly semaphore = new Semaphore(LIMITS.thumbnailConcurrency);
  private readonly maxCache = LIMITS.thumbnailCacheSize;

  /** Resolved pixel ratio, capped so 3x phones do not render 3x bitmaps. */
  private get pixelRatio(): number {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    return Math.min(Math.max(dpr, 1), 2);
  }

  peek(fileId: string, pageNumber: number, targetWidth: number): Thumbnail | undefined {
    const key = this.cacheKey(fileId, pageNumber, targetWidth);
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    // Refresh LRU position.
    this.cache.delete(key);
    this.cache.set(key, hit);
    return hit;
  }

  private cacheKey(fileId: string, pageNumber: number, targetWidth: number): string {
    // Width is part of the key: the 104 px strip and the 720 px dialog must not
    // evict each other's bitmaps.
    return `${fileId}:${pageNumber}:${Math.round(targetWidth)}`;
  }

  private remember(key: string, thumbnail: Thumbnail): void {
    this.cache.set(key, thumbnail);
    while (this.cache.size > this.maxCache) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }

  private getEntry(fileId: string, file: File): DocumentEntry {
    const existing = this.documents.get(fileId);
    if (existing) return existing;

    const entry: DocumentEntry = {
      disposed: false,
      promise: (async () => {
        const pdfjs = await loadPdfJs();
        const data = new Uint8Array(await file.arrayBuffer());
        const task = pdfjs.getDocument({
          data,
          // Local processing only: no network fetches, no remote CMap lookups.
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          isEvalSupported: false,
          disableAutoFetch: true,
          disableStream: true,
        });
        const doc = await task.promise;
        return { doc, task };
      })(),
    };

    // Avoid unhandled rejections when the document fails to load.
    entry.promise.catch(() => undefined);
    this.documents.set(fileId, entry);
    return entry;
  }

  /**
   * Page box in PDF points, with /Rotate already applied — used by the preview
   * dialog to define what "100%" means for this page.
   */
  async getPageSize(
    fileId: string,
    file: File,
    pageNumber: number,
  ): Promise<{ width: number; height: number } | null> {
    try {
      const page = await this.loadPage(fileId, file, pageNumber);
      if (!page) return null;
      const viewport = page.getViewport({ scale: 1 });
      return { width: viewport.width, height: viewport.height };
    } catch {
      return null;
    }
  }

  private async loadPage(fileId: string, file: File, pageNumber: number): Promise<PDFPageProxy | null> {
    const entry = this.getEntry(fileId, file);
    const { doc } = await entry.promise;
    if (entry.disposed) return null;
    if (pageNumber < 1 || pageNumber > doc.numPages) return null;
    return doc.getPage(pageNumber);
  }

  async getThumbnail(
    fileId: string,
    file: File,
    pageNumber: number,
    targetWidth: number,
  ): Promise<Thumbnail | null> {
    const cached = this.peek(fileId, pageNumber, targetWidth);
    if (cached) return cached;

    await this.semaphore.acquire();
    const key = this.cacheKey(fileId, pageNumber, targetWidth);
    try {
      const again = this.peek(fileId, pageNumber, targetWidth);
      if (again) return again;

      const page = await this.loadPage(fileId, file, pageNumber);
      if (!page) return null;

      const thumbnail = await this.render(page, targetWidth);
      this.remember(key, thumbnail);
      return thumbnail;
    } catch {
      // A single broken page must not break the whole strip.
      return null;
    } finally {
      this.semaphore.release();
    }
  }

  /** Renders one page into a data URL. The canvas bitmap is released right away. */
  private async render(page: PDFPageProxy, targetCssWidth: number): Promise<Thumbnail> {
    const base = page.getViewport({ scale: 1 });
    const ratio = this.pixelRatio;
    const scale = (targetCssWidth * ratio) / base.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('canvas 2d context unavailable');

    const thumbnail: Thumbnail = {
      url: '',
      width: Math.round(viewport.width / ratio),
      height: Math.round(viewport.height / ratio),
    };

    try {
      await page.render({
        canvasContext: context,
        viewport,
        background: '#ffffff',
      }).promise;

      thumbnail.url = canvas.toDataURL('image/webp', 0.86);
      if (!thumbnail.url.startsWith('data:image/webp')) {
        // Safari < 16 has no WebP encoder; fall back to PNG.
        thumbnail.url = canvas.toDataURL('image/png');
      }
      return thumbnail;
    } finally {
      // Explicitly drop the backing bitmap: canvases are a common source of
      // "tab uses 2 GB of memory" reports.
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  /** Releases the pdf.js document and every cached thumbnail for one file. */
  release(fileId: string): void {
    const entry = this.documents.get(fileId);
    this.documents.delete(fileId);
    if (entry) {
      entry.disposed = true;
      void entry.promise
        .then(({ task }) => task.destroy())
        .catch(() => undefined);
    }
    const prefix = `${fileId}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  releaseAll(): void {
    for (const fileId of [...this.documents.keys()]) this.release(fileId);
    this.cache.clear();
  }
}

export const thumbnailService = new ThumbnailService();
