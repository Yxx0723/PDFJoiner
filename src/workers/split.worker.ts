/**
 * Split worker.
 *
 * One document, one job at a time. The file bytes are transferred in with the
 * job (a move, not a copy) because the source document has to stay parsed for
 * the whole task — that is exactly what keeps "split into 300 files" from doing
 * 300 parses.
 */

import { MergeCancelledError, PdfEngineError, splitPdf } from '@/features/pdf-split/engine';
import type { SplitWorkerRequest, SplitWorkerResponse, SplitWorkerFile } from '@/features/pdf-split/protocol';
import { serializeError } from '@/features/pdf/protocol';

type WorkerScope = {
  postMessage(message: SplitWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<SplitWorkerRequest>) => void,
    options?: AddEventListenerOptions,
  ): void;
};

const scope = self as unknown as WorkerScope;

/** Jobs cancelled from the UI. Checked between page batches and between files. */
const cancelled = new Set<string>();

function toTransferable(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

async function handleSplit(id: string, buffer: ArrayBuffer, jobs: { name: string; pages: number[] }[]) {
  try {
    const outcome = await splitPdf(new Uint8Array(buffer), jobs, {
      shouldCancel: () => cancelled.has(id),
      onProgress: (progress) => scope.postMessage({ kind: 'progress', id, progress }),
    });

    const files: SplitWorkerFile[] = [];
    const transfer: ArrayBuffer[] = [];
    for (const file of outcome.files) {
      const owned = toTransferable(file.bytes);
      files.push({
        name: file.name,
        pages: file.pages,
        pageCount: file.pageCount,
        buffer: owned,
      });
      transfer.push(owned);
    }

    scope.postMessage({ kind: 'split-result', id, files, verified: outcome.verified }, transfer);
  } catch (error) {
    if (error instanceof MergeCancelledError) {
      scope.postMessage({ kind: 'split-cancelled', id });
      return;
    }
    const serialized =
      error instanceof PdfEngineError
        ? serializeError(error)
        : serializeError(error instanceof Error ? error : new Error(String(error)));
    scope.postMessage({ kind: 'split-error', id, error: serialized });
  } finally {
    cancelled.delete(id);
  }
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  switch (message.kind) {
    case 'split':
      void handleSplit(message.id, message.buffer, message.jobs);
      break;
    case 'cancel':
      cancelled.add(message.id);
      break;
    default:
      break;
  }
});
