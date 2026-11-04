/**
 * PDF engine worker.
 *
 * Owns every heavy pdf-lib operation so the main thread stays interactive even
 * with large documents. Raw bytes are pulled from the main thread one file at a
 * time (instead of shipping the whole job up front) to keep peak memory close
 * to "output + current input".
 */

import { MergeCancelledError, PdfEngineError, inspectPdfBytes, mergePdfPlans } from '@/features/pdf/engine';
import { serializeError } from '@/features/pdf/protocol';
import type { WorkerRequest, WorkerResponse } from '@/features/pdf/protocol';

type WorkerScope = {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
    options?: AddEventListenerOptions,
  ): void;
};

const scope = self as unknown as WorkerScope;

/** Jobs cancelled from the UI. Checked between batches of pages. */
const cancelledJobs = new Set<string>();

/** Pending "please send me the bytes of file #n" promises, per job. */
const byteRequests = new Map<string, Array<{ index: number; resolve: (bytes: Uint8Array) => void }>>();

function post(message: WorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

/** Returns an ArrayBuffer that owns its memory and can be transferred. */
function toTransferable(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

function requestBytes(jobId: string, index: number): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const waiting = byteRequests.get(jobId) ?? [];
    waiting.push({ index, resolve });
    byteRequests.set(jobId, waiting);
    post({ kind: 'need-bytes', id: jobId, index });
  });
}

function releaseJob(jobId: string): void {
  byteRequests.delete(jobId);
  cancelledJobs.delete(jobId);
}

async function handleInspect(id: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const inspection = await inspectPdfBytes(new Uint8Array(buffer));
    post({ kind: 'inspect-result', id, inspection });
  } catch (error) {
    post({ kind: 'inspect-error', id, error: serializeError(error) });
  }
}

async function handleMerge(id: string, title: string, files: { name: string; pages: number[] }[]) {
  try {
    const outcome = await mergePdfPlans(files, {
      getBytes: (index) => requestBytes(id, index),
      title,
      shouldCancel: () => cancelledJobs.has(id),
      onProgress: (progress) => post({ kind: 'progress', id, progress }),
    });

    const buffer = toTransferable(outcome.bytes);
    post(
      {
        kind: 'merge-result',
        id,
        buffer,
        pageCount: outcome.pageCount,
        verified: outcome.verified,
      },
      [buffer],
    );
  } catch (error) {
    if (error instanceof MergeCancelledError) {
      post({ kind: 'merge-cancelled', id });
      return;
    }
    if (error instanceof PdfEngineError) {
      post({ kind: 'merge-error', id, error: serializeError(error) });
      return;
    }
    post({ kind: 'merge-error', id, error: serializeError(error) });
  } finally {
    releaseJob(id);
  }
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  switch (message.kind) {
    case 'inspect':
      void handleInspect(message.id, message.buffer);
      break;
    case 'merge':
      void handleMerge(message.id, message.title, message.files);
      break;
    case 'merge-bytes': {
      const waiting = byteRequests.get(message.id);
      const pending = waiting?.shift();
      if (pending && pending.index === message.index) {
        pending.resolve(new Uint8Array(message.buffer));
      }
      break;
    }
    case 'cancel':
      cancelledJobs.add(message.id);
      break;
    default:
      break;
  }
});
