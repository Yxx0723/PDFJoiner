/**
 * Main-thread façade for the PDF worker.
 *
 * Responsibilities:
 *  - lazily create the worker and keep a typed RPC map;
 *  - feed file bytes to the worker only when it asks for them;
 *  - translate worker failures into `PdfEngineError`s;
 *  - tear the worker down after a merge so pdf-lib's memory is released.
 */

import { createId } from '@/lib/utils';
import { MergeCancelledError, PdfEngineError } from './errors';
import type { MergePlanFile, MergeProgress, MergeOutcome, PdfInspection } from './engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface MergeRequest {
  files: MergePlanFile[];
  /** Used as the output document title; falls back to the source title. */
  title: string;
  getBytes: (index: number) => Promise<Uint8Array>;
  onProgress?: (progress: MergeProgress) => void;
}

interface MergeTicket extends MergeRequest {
  id: string;
  resolve: (outcome: MergeOutcome) => void;
  reject: (error: unknown) => void;
}

interface InspectionTicket {
  resolve: (inspection: PdfInspection) => void;
  reject: (error: unknown) => void;
}

export class PdfEngineClient {
  private worker: Worker | null = null;
  private inspections = new Map<string, InspectionTicket>();
  private mergeTicket: MergeTicket | null = null;

  get isMerging(): boolean {
    return this.mergeTicket !== null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('../../workers/pdf.worker.ts', import.meta.url), {
      type: 'module',
      name: 'pdfjoiner-engine',
    });

    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    });
    worker.addEventListener('error', (event) => {
      event.preventDefault?.();
      this.failAll(
        new PdfEngineError(
          'worker-crashed',
          'PDF 处理线程意外退出，请刷新页面后重试。若文件很大，请减少批量。',
        ),
      );
    });
    worker.addEventListener('messageerror', () => {
      this.failAll(new PdfEngineError('worker-crashed', 'PDF 处理线程通信失败，请重试。'));
    });

    this.worker = worker;
    return worker;
  }

  private handleMessage(message: WorkerResponse): void {
    switch (message.kind) {
      case 'inspect-result': {
        const ticket = this.inspections.get(message.id);
        this.inspections.delete(message.id);
        ticket?.resolve(message.inspection);
        break;
      }
      case 'inspect-error': {
        const ticket = this.inspections.get(message.id);
        this.inspections.delete(message.id);
        ticket?.reject(fromSerialized(message.error));
        break;
      }
      case 'need-bytes': {
        const ticket = this.mergeTicket;
        if (!ticket || ticket.id !== message.id) return;
        void this.sendBytes(ticket, message.index);
        break;
      }
      case 'progress': {
        const ticket = this.mergeTicket;
        if (!ticket || ticket.id !== message.id) return;
        ticket.onProgress?.(message.progress);
        break;
      }
      case 'merge-result': {
        const ticket = this.mergeTicket;
        if (!ticket || ticket.id !== message.id) return;
        this.mergeTicket = null;
        ticket.resolve({
          bytes: new Uint8Array(message.buffer),
          pageCount: message.pageCount,
          verified: message.verified,
        });
        this.releaseWhenIdle();
        break;
      }
      case 'merge-error': {
        const ticket = this.mergeTicket;
        if (!ticket || ticket.id !== message.id) return;
        this.mergeTicket = null;
        ticket.reject(fromSerialized(message.error));
        this.releaseWhenIdle();
        break;
      }
      case 'merge-cancelled': {
        const ticket = this.mergeTicket;
        if (!ticket || ticket.id !== message.id) return;
        this.mergeTicket = null;
        ticket.reject(new MergeCancelledError());
        this.releaseWhenIdle();
        break;
      }
      default:
        break;
    }
  }

  private async sendBytes(ticket: MergeTicket, index: number): Promise<void> {
    try {
      const bytes = await ticket.getBytes(index);
      const buffer =
        bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
          ? (bytes.buffer as ArrayBuffer)
          : (bytes.slice().buffer as ArrayBuffer);

      if (!this.worker || this.mergeTicket?.id !== ticket.id) return;

      const message: WorkerRequest = { kind: 'merge-bytes', id: ticket.id, index, buffer };
      this.worker.postMessage(message, [buffer]);
    } catch (error) {
      this.mergeTicket = null;
      ticket.reject(
        new PdfEngineError('unknown', `读取「${ticket.files[index]?.name ?? '文件'}」失败：${describe(error)}`, {
          cause: error,
        }),
      );
      this.releaseWhenIdle();
    }
  }

  private failAll(error: Error): void {
    for (const ticket of this.inspections.values()) ticket.reject(error);
    this.inspections.clear();

    if (this.mergeTicket) {
      const ticket = this.mergeTicket;
      this.mergeTicket = null;
      ticket.reject(error);
    }
    this.terminate();
  }

  private releaseWhenIdle(): void {
    if (this.inspections.size === 0) this.terminate();
  }

  /** Reads page metadata for one file. Bytes are transferred, not copied. */
  async inspect(file: File): Promise<PdfInspection> {
    const buffer = await file.arrayBuffer();
    const worker = this.ensureWorker();
    const id = createId();

    return new Promise<PdfInspection>((resolve, reject) => {
      this.inspections.set(id, { resolve, reject });
      worker.postMessage({ kind: 'inspect', id, buffer } satisfies WorkerRequest, [buffer]);
    });
  }

  async merge(request: MergeRequest): Promise<MergeOutcome> {
    if (this.mergeTicket) {
      throw new PdfEngineError('unknown', '已有合并任务在进行中。');
    }

    const worker = this.ensureWorker();
    const id = createId();

    return new Promise<MergeOutcome>((resolve, reject) => {
      this.mergeTicket = { ...request, id, resolve, reject };
      worker.postMessage({
        kind: 'merge',
        id,
        title: request.title,
        files: request.files,
      } satisfies WorkerRequest);
    });
  }

  /** Requests a cooperative cancel; the worker stops between page batches. */
  cancel(): void {
    if (!this.mergeTicket || !this.worker) return;
    this.worker.postMessage({ kind: 'cancel', id: this.mergeTicket.id } satisfies WorkerRequest);
  }

  /** Forcefully drops the worker (and all pdf-lib memory it holds). */
  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fromSerialized(error: { code: string; message: string; fileName?: string }): Error {
  return new PdfEngineError(error.code as PdfEngineError['code'], error.message, {
    fileName: error.fileName,
  });
}

/** App-wide singleton: one worker at a time, recreated on demand. */
export const pdfEngine = new PdfEngineClient();
