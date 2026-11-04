/**
 * Image → PDF worker.
 *
 * Decoding and encoding happen here so a 20-image batch does not lock up the
 * UI. The worker receives `Blob`s (structured-cloned by reference — no byte copy),
 * decodes them with `createImageBitmap`, normalises them on an `OffscreenCanvas`
 * and hands the finished PDF back as a transferable buffer.
 */

import { buildImagePdf } from '@/features/image-pdf/build';
import { createOffscreenCanvasFactory, encodeImage } from '@/features/image-pdf/encode';
import { ImagePdfCancelledError, ImagePdfError } from '@/features/image-pdf/errors';
import { loadImageSource } from '@/features/image-pdf/source';
import type { ImageWorkerRequest, ImageWorkerResponse } from '@/features/image-pdf/protocol';
import type { ImageJob, ImagePdfSettings } from '@/features/image-pdf/types';
import { serializeError } from '@/features/pdf/protocol';

type WorkerScope = {
  postMessage(message: ImageWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<ImageWorkerRequest>) => void,
  ): void;
};

const scope = self as unknown as WorkerScope;
const factory = createOffscreenCanvasFactory();

/** Jobs cancelled from the UI; polled between images. */
const cancelled = new Set<string>();

function post(message: ImageWorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

function toTransferable(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

async function handleBuild(
  id: string,
  jobs: ImageJob[],
  settings: ImagePdfSettings,
): Promise<void> {
  try {
    const outcome = await buildImagePdf(
      jobs,
      settings,
      {
        encode: async (job, layout, options) => {
          const loaded = await loadImageSource(job.file);
          try {
            return await encodeImage(
              {
                source: loaded.source,
                job,
                layout,
                settings,
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
        shouldCancel: () => cancelled.has(id),
        onProgress: (progress) => post({ kind: 'progress', id, progress }),
      },
    );

    const buffer = toTransferable(outcome.bytes);
    post(
      {
        kind: 'result',
        id,
        buffer,
        pageCount: outcome.pageCount,
        verified: outcome.verified,
        pages: outcome.pages,
      },
      [buffer],
    );
  } catch (error) {
    if (error instanceof ImagePdfCancelledError) {
      post({ kind: 'cancelled', id });
      return;
    }
    if (error instanceof ImagePdfError) {
      post({ kind: 'error', id, error: serializeError(error) });
      return;
    }
    post({ kind: 'error', id, error: serializeError(error) });
  } finally {
    cancelled.delete(id);
  }
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  switch (message.kind) {
    case 'build':
      void handleBuild(message.id, message.jobs, message.settings);
      break;
    case 'cancel':
      cancelled.add(message.id);
      break;
    default:
      break;
  }
});
