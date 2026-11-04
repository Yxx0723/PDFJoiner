/**
 * Main-thread façade for the rotation worker.
 *
 * One worker at a time, recreated on demand. Once every ticket settles the
 * worker is torn down so pdf-lib's parsed document does not stay in memory
 * while the user is just looking at thumbnails.
 */

import { createId } from '@/lib/utils';
import { MergeCancelledError, PdfEngineError } from '@/features/pdf/errors';
import type { RotateInspection, RotateOutcome, RotateProgress, RotationJob } from './types';
import type { RotateWorkerRequest, RotateWorkerResponse } from './protocol';

export interface RotateRequest {
  bytes: Uint8Array;
  jobs: RotationJob[];
  onProgress?: (progress: RotateProgress) => void;
}

type Ticket =
  | {
      kind: 'inspect';
      id: string;
      resolve: (value: RotateInspection) => void;
      reject: (error: unknown) => void;
    }
  | {
      kind: 'rotate';
      id: string;
      resolve: (value: RotateOutcome) => void;
      reject: (error: unknown) => void;
      onProgress?: (progress: RotateProgress) => void;
    };

function fromSerialized(error: { code: string; message: string; fileName?: string }): Error {
  return new PdfEngineError(error.code as PdfEngineError['code'], error.message, {
    fileName: error.fileName,
  });
}

export class RotateEngineClient {
  private worker: Worker | null = null;
  private readonly tickets = new Map<string, Ticket>();
  private rotatingId: string | null = null;
  /** Covers a cancel that arrives before the bytes have been transferred. */
  private cancelRequested = false;

  get isExporting(): boolean {
    return this.rotatingId !== null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('../../workers/rotate.worker.ts', import.meta.url), {
      type: 'module',
      name: 'pdfjoiner-rotate',
    });

    worker.addEventListener('message', (event: MessageEvent<RotateWorkerResponse>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      this.failAll(
        new PdfEngineError(
          'worker-crashed',
          '旋转处理线程意外退出，请刷新页面后重试。若文件很大，请尝试分批操作。',
        ),
      );
    });
    worker.addEventListener('messageerror', () => {
      this.failAll(new PdfEngineError('worker-crashed', '旋转处理线程通信失败，请重试。'));
    });

    this.worker = worker;
    return worker;
  }

  private settle(id: string): void {
    this.tickets.delete(id);
    if (this.rotatingId === id) this.rotatingId = null;
    if (this.tickets.size === 0) this.terminate();
  }

  private handleMessage(message: RotateWorkerResponse): void {
    const ticket = this.tickets.get(message.id);
    if (!ticket) return;

    switch (message.kind) {
      case 'progress':
        if (ticket.kind === 'rotate') ticket.onProgress?.(message.progress);
        return;
      case 'inspect-result':
        if (ticket.kind !== 'inspect') return;
        this.settle(message.id);
        ticket.resolve(message.result);
        return;
      case 'inspect-error':
        if (ticket.kind !== 'inspect') return;
        this.settle(message.id);
        ticket.reject(fromSerialized(message.error));
        return;
      case 'rotate-result':
        if (ticket.kind !== 'rotate') return;
        this.settle(message.id);
        ticket.resolve({
          bytes: new Uint8Array(message.buffer),
          pageCount: message.pageCount,
          rotations: message.rotations,
          verified: message.verified,
        });
        return;
      case 'rotate-error':
        if (ticket.kind !== 'rotate') return;
        this.settle(message.id);
        ticket.reject(fromSerialized(message.error));
        return;
      case 'rotate-cancelled':
        if (ticket.kind !== 'rotate') return;
        this.settle(message.id);
        ticket.reject(new MergeCancelledError('旋转已取消。'));
        return;
      default:
        return;
    }
  }

  private failAll(error: Error): void {
    const pending = [...this.tickets.values()];
    this.tickets.clear();
    this.rotatingId = null;
    this.worker?.terminate();
    this.worker = null;
    for (const ticket of pending) ticket.reject(error);
  }

  /** Reads the full per-page rotation table in the worker. */
  async inspect(file: File): Promise<RotateInspection> {
    const buffer = await file.arrayBuffer();
    const worker = this.ensureWorker();
    const id = createId();

    return new Promise<RotateInspection>((resolve, reject) => {
      this.tickets.set(id, { kind: 'inspect', id, resolve, reject });
      worker.postMessage({ kind: 'inspect', id, buffer } satisfies RotateWorkerRequest, [buffer]);
    });
  }

  async rotate(request: RotateRequest): Promise<RotateOutcome> {
    if (this.rotatingId) {
      throw new PdfEngineError('unknown', '已有旋转任务在进行中。');
    }

    const worker = this.ensureWorker();
    const id = createId();
    this.cancelRequested = false;

    const buffer =
      request.bytes.byteOffset === 0 &&
      request.bytes.byteLength === request.bytes.buffer.byteLength
        ? (request.bytes.buffer as ArrayBuffer)
        : (request.bytes.slice().buffer as ArrayBuffer);

    return new Promise<RotateOutcome>((resolve, reject) => {
      if (this.cancelRequested) {
        reject(new MergeCancelledError('旋转已取消。'));
        return;
      }
      this.rotatingId = id;
      this.tickets.set(id, {
        kind: 'rotate',
        id,
        resolve,
        reject,
        onProgress: request.onProgress,
      });
      worker.postMessage(
        { kind: 'rotate', id, buffer, jobs: request.jobs } satisfies RotateWorkerRequest,
        [buffer],
      );
    });
  }

  /**
   * Cooperative cancel **plus** hard termination.
   *
   * pdf-lib's `save()` is synchronous, so a worker stuck inside it cannot read
   * a `cancel` message. Terminating is the only way to guarantee the half-built
   * PDF is never offered for download.
   */
  cancel(): void {
    this.cancelRequested = true;
    const id = this.rotatingId;
    if (!id) return;

    const ticket = this.tickets.get(id);
    if (this.worker) {
      this.worker.postMessage({ kind: 'cancel', id } satisfies RotateWorkerRequest);
    }
    this.tickets.delete(id);
    this.rotatingId = null;
    ticket?.reject(new MergeCancelledError('旋转已取消。'));

    const pending = [...this.tickets.values()];
    this.tickets.clear();
    for (const other of pending) {
      other.reject(new PdfEngineError('cancelled', '任务已取消。'));
    }
    this.terminate();
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.cancelRequested = false;
  }
}

/** One rotation worker at a time, recreated on demand. */
export const rotateEngine = new RotateEngineClient();
