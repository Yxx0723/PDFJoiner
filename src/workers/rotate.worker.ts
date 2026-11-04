/**
 * Rotation worker.
 *
 * Source bytes arrive as a transferred ArrayBuffer (a move, not a copy) and the
 * finished PDF leaves the same way. Only plain progress/error objects cross the
 * boundary — file contents never do.
 */

import { MergeCancelledError, PdfEngineError, inspectForRotation, rotatePdf } from '@/features/pdf-rotate/engine';
import type {
  RotateWorkerRequest,
  RotateWorkerResponse,
} from '@/features/pdf-rotate/protocol';
import { serializeError } from '@/features/pdf/protocol';

type WorkerScope = {
  postMessage(message: RotateWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<RotateWorkerRequest>) => void,
    options?: AddEventListenerOptions,
  ): void;
};

const scope = self as unknown as WorkerScope;

/** Job ids cancelled from the UI, checked between page batches. */
const cancelled = new Set<string>();

function toTransferable(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

function asSerialized(error: unknown) {
  return serializeError(
    error instanceof PdfEngineError || error instanceof Error ? error : new Error(String(error)),
  );
}

async function handleInspect(id: string, buffer: ArrayBuffer): Promise<void> {
  try {
    const result = await inspectForRotation(new Uint8Array(buffer));
    scope.postMessage({ kind: 'inspect-result', id, result });
  } catch (error) {
    scope.postMessage({ kind: 'inspect-error', id, error: asSerialized(error) });
  }
}

async function handleRotate(
  id: string,
  buffer: ArrayBuffer,
  jobs: { pageIndex: number; finalAngle: 0 | 90 | 180 | 270 }[],
): Promise<void> {
  try {
    const outcome = await rotatePdf(new Uint8Array(buffer), jobs, {
      shouldCancel: () => cancelled.has(id),
      onProgress: (progress) => scope.postMessage({ kind: 'progress', id, progress }),
    });

    const owned = toTransferable(outcome.bytes);
    scope.postMessage(
      {
        kind: 'rotate-result',
        id,
        buffer: owned,
        pageCount: outcome.pageCount,
        rotations: outcome.rotations,
        verified: outcome.verified,
      },
      [owned],
    );
  } catch (error) {
    if (error instanceof MergeCancelledError || (error as { code?: string })?.code === 'cancelled') {
      scope.postMessage({ kind: 'rotate-cancelled', id });
      return;
    }
    scope.postMessage({ kind: 'rotate-error', id, error: asSerialized(error) });
  } finally {
    cancelled.delete(id);
  }
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  switch (message.kind) {
    case 'inspect':
      void handleInspect(message.id, message.buffer);
      break;
    case 'rotate':
      void handleRotate(message.id, message.buffer, message.jobs);
      break;
    case 'cancel':
      cancelled.add(message.id);
      break;
    default:
      break;
  }
});
