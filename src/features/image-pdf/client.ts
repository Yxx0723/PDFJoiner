/**
 * Main-thread façade for the image worker, with a main-thread fallback.
 *
 * The worker needs `OffscreenCanvas` + `createImageBitmap`. Where those are
 * missing (older Safari/WebKit) the exact same `buildImagePdf` code runs on the
 * main thread with a DOM canvas: correct, just not as smooth. The UI surfaces
 * which path was taken so nobody is misled about where the work happened.
 */

import { createId } from '@/lib/utils';
import { canEncodeOffscreen, createDomCanvasFactory, encodeImage } from './encode';
import { ImagePdfCancelledError, ImagePdfError } from './errors';
import { loadImageSource } from './source';
import type { ImageWorkerRequest, ImageWorkerResponse } from './protocol';
import type { BuildOutcome, ImageJob, ImagePdfProgress, ImagePdfSettings } from './types';

export interface ImageBuildRequest {
  jobs: ImageJob[];
  settings: ImagePdfSettings;
  onProgress?: (progress: ImagePdfProgress) => void;
}

interface Ticket extends ImageBuildRequest {
  id: string;
  resolve: (outcome: BuildOutcome) => void;
  reject: (error: unknown) => void;
}

function fromSerialized(error: { code: string; message: string; fileName?: string }): Error {
  return new ImagePdfError(error.code as ImagePdfError['code'], error.message, {
    fileName: error.fileName,
  });
}

export class ImageEngineClient {
  private worker: Worker | null = null;
  private ticket: Ticket | null = null;
  private localRunning = false;
  private localCancelled = false;

  /** `false` means the DOM fallback is in use for this browser. */
  get usesWorker(): boolean {
    return canEncodeOffscreen();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('../../workers/image.worker.ts', import.meta.url), {
      type: 'module',
      name: 'pdfjoiner-images',
    });

    worker.addEventListener('message', (event: MessageEvent<ImageWorkerResponse>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      this.fail(
        new ImagePdfError(
          'worker-crashed',
          '图片处理线程意外退出，请刷新页面后重试；若图片很大，请减少一次处理的数量。',
        ),
      );
    });
    worker.addEventListener('messageerror', () => {
      this.fail(new ImagePdfError('worker-crashed', '图片处理线程通信失败，请重试。'));
    });

    this.worker = worker;
    return worker;
  }

  private handleMessage(message: ImageWorkerResponse): void {
    const ticket = this.ticket;
    if (!ticket || ticket.id !== message.id) return;

    switch (message.kind) {
      case 'progress':
        ticket.onProgress?.(message.progress);
        break;
      case 'result':
        this.ticket = null;
        ticket.resolve({
          bytes: new Uint8Array(message.buffer),
          pageCount: message.pageCount,
          verified: message.verified,
          pages: message.pages,
        });
        this.releaseWhenIdle();
        break;
      case 'error':
        this.ticket = null;
        ticket.reject(fromSerialized(message.error));
        this.releaseWhenIdle();
        break;
      case 'cancelled':
        this.ticket = null;
        ticket.reject(new ImagePdfCancelledError());
        this.releaseWhenIdle();
        break;
      default:
        break;
    }
  }

  private fail(error: Error): void {
    if (this.ticket) {
      const ticket = this.ticket;
      this.ticket = null;
      ticket.reject(error);
    }
    this.terminate();
  }

  private releaseWhenIdle(): void {
    this.terminate();
  }

  async build(request: ImageBuildRequest): Promise<BuildOutcome> {
    if (this.ticket || this.localRunning) {
      throw new ImagePdfError('unknown', '已有生成任务在进行中。');
    }
    if (!canEncodeOffscreen()) return this.runLocally(request);

    const worker = this.ensureWorker();
    const id = createId();

    return new Promise<BuildOutcome>((resolve, reject) => {
      this.ticket = { ...request, id, resolve, reject };
      worker.postMessage({
        kind: 'build',
        id,
        jobs: request.jobs,
        settings: request.settings,
        // Blobs clone by reference; nothing large is copied here.
      } satisfies ImageWorkerRequest);
    });
  }

  private async runLocally(request: ImageBuildRequest): Promise<BuildOutcome> {
    this.localRunning = true;
    this.localCancelled = false;
    const factory = createDomCanvasFactory();

    try {
      // Loaded on demand: pdf-lib is ~400 kB and must not end up in the initial
      // bundle of a tool that normally runs entirely inside the worker.
      const { buildImagePdf } = await import('./build');
      return await buildImagePdf(
        request.jobs,
        request.settings,
        {
          encode: async (job, layout, options) => {
            const loaded = await loadImageSource(job.file);
            try {
              return await encodeImage(
                {
                  source: loaded.source,
                  job,
                  layout,
                  settings: request.settings,
                  forceReencode: options.forceReencode,
                },
                factory,
              );
            } finally {
              loaded.release();
            }
          },
        },
        {
          shouldCancel: () => this.localCancelled,
          onProgress: request.onProgress,
        },
      );
    } finally {
      this.localRunning = false;
      this.localCancelled = false;
    }
  }

  /** Cooperative cancel; the engine stops at the next image boundary. */
  cancel(): void {
    if (this.localRunning) {
      this.localCancelled = true;
      return;
    }
    if (!this.ticket || !this.worker) return;
    this.worker.postMessage({ kind: 'cancel', id: this.ticket.id } satisfies ImageWorkerRequest);
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

/** One worker at a time, recreated on demand so pdf-lib memory is reclaimed. */
export const imageEngine = new ImageEngineClient();
