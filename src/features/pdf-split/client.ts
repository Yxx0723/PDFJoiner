/**
 * Main-thread façade for the split worker.
 *
 * Mirrors the merge client's contract: one job at a time, cooperative cancel,
 * worker torn down as soon as a job settles so pdf-lib's memory goes with it.
 */

import { createId } from '@/lib/utils';
import { MergeCancelledError, PdfEngineError } from '@/features/pdf/errors';
import type { SplitJob, SplitOutcome, SplitProgress } from './engine';
import type { SplitWorkerRequest, SplitWorkerResponse } from './protocol';

export interface SplitRequest {
  bytes: Uint8Array;
  jobs: SplitJob[];
  onProgress?: (progress: SplitProgress) => void;
}

interface Ticket {
  id: string;
  resolve: (outcome: SplitOutcome) => void;
  reject: (error: unknown) => void;
  onProgress?: (progress: SplitProgress) => void;
}

export class SplitEngineClient {
  private worker: Worker | null = null;
  private ticket: Ticket | null = null;
  /** Aborts the job when the caller cancels before the bytes are transferred. */
  private cancelRequested = false;

  get isSplitting(): boolean {
    return this.ticket !== null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('../../workers/split.worker.ts', import.meta.url), {
      type: 'module',
      name: 'pdfjoiner-split',
    });

    worker.addEventListener('message', (event: MessageEvent<SplitWorkerResponse>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      this.fail(
        new PdfEngineError(
          'worker-crashed',
          '拆分处理线程意外退出，请刷新页面后重试。若文件很大，请改用「按固定页数」并增大每份页数。',
        ),
      );
    });
    worker.addEventListener('messageerror', () => {
      this.fail(new PdfEngineError('worker-crashed', '拆分处理线程通信失败，请重试。'));
    });

    this.worker = worker;
    return worker;
  }

  private handleMessage(message: SplitWorkerResponse): void {
    const ticket = this.ticket;
    if (!ticket || ticket.id !== message.id) return;

    switch (message.kind) {
      case 'progress':
        ticket.onProgress?.(message.progress);
        break;
      case 'split-result': {
        this.ticket = null;
        ticket.resolve({
          verified: message.verified,
          files: message.files.map((file) => ({
            name: file.name,
            pages: file.pages,
            pageCount: file.pageCount,
            bytes: new Uint8Array(file.buffer),
          })),
        });
        this.terminate();
        break;
      }
      case 'split-error': {
        this.ticket = null;
        ticket.reject(
          new PdfEngineError(
            message.error.code as PdfEngineError['code'],
            message.error.message,
            { fileName: message.error.fileName },
          ),
        );
        this.terminate();
        break;
      }
      case 'split-cancelled': {
        this.ticket = null;
        ticket.reject(new MergeCancelledError('拆分已取消。'));
        this.terminate();
        break;
      }
      default:
        break;
    }
  }

  private fail(error: Error): void {
    const ticket = this.ticket;
    this.ticket = null;
    ticket?.reject(error);
    this.terminate();
  }

  async split(request: SplitRequest): Promise<SplitOutcome> {
    if (this.ticket) {
      throw new PdfEngineError('unknown', '已有拆分任务在进行中。');
    }

    const worker = this.ensureWorker();
    const id = createId();
    this.cancelRequested = false;

    const buffer =
      request.bytes.byteOffset === 0 &&
      request.bytes.byteLength === request.bytes.buffer.byteLength
        ? (request.bytes.buffer as ArrayBuffer)
        : (request.bytes.slice().buffer as ArrayBuffer);

    return new Promise<SplitOutcome>((resolve, reject) => {
      if (this.cancelRequested) {
        reject(new MergeCancelledError('拆分已取消。'));
        return;
      }

      this.ticket = { id, resolve, reject, onProgress: request.onProgress };
      worker.postMessage(
        { kind: 'split', id, buffer, jobs: request.jobs } satisfies SplitWorkerRequest,
        [buffer],
      );
    });
  }

  /** Cooperative cancel: the worker stops before the next page batch. */
  cancel(): void {
    this.cancelRequested = true;
    if (!this.ticket || !this.worker) return;
    this.worker.postMessage({ kind: 'cancel', id: this.ticket.id } satisfies SplitWorkerRequest);
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.cancelRequested = false;
  }
}

/** One split worker at a time, recreated on demand. */
export const splitEngine = new SplitEngineClient();
