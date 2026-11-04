import type { MergePlanFile, MergeProgress, PdfInspection } from './engine';

/** Main thread → worker. */
export type WorkerRequest =
  | { kind: 'inspect'; id: string; buffer: ArrayBuffer }
  | {
      kind: 'merge';
      id: string;
      title: string;
      files: MergePlanFile[];
    }
  | { kind: 'merge-bytes'; id: string; index: number; buffer: ArrayBuffer }
  | { kind: 'cancel'; id: string };

/** Worker → main thread. */
export type WorkerResponse =
  | { kind: 'inspect-result'; id: string; inspection: PdfInspection }
  | { kind: 'inspect-error'; id: string; error: SerializedError }
  | { kind: 'need-bytes'; id: string; index: number }
  | { kind: 'progress'; id: string; progress: MergeProgress }
  | {
      kind: 'merge-result';
      id: string;
      buffer: ArrayBuffer;
      pageCount: number;
      verified: boolean;
    }
  | { kind: 'merge-error'; id: string; error: SerializedError }
  | { kind: 'merge-cancelled'; id: string };

export interface SerializedError {
  name: string;
  code: string;
  message: string;
  fileName?: string;
}

/**
 * Errors cross the worker boundary as plain objects. Only the message and the
 * error code are forwarded — never file contents.
 */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const coded = error as Error & { code?: string; fileName?: string };
    return {
      name: error.name || 'Error',
      code: typeof coded.code === 'string' ? coded.code : 'unknown',
      message: error.message,
      fileName: coded.fileName,
    };
  }
  return { name: 'Error', code: 'unknown', message: String(error) };
}
