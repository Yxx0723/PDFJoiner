import type { SerializedError } from '@/features/pdf/protocol';
import type { SplitJob, SplitProgress } from './engine';

/** Main thread → split worker. */
export type SplitWorkerRequest =
  | { kind: 'split'; id: string; buffer: ArrayBuffer; jobs: SplitJob[] }
  | { kind: 'cancel'; id: string };

export interface SplitWorkerFile {
  name: string;
  pages: number[];
  pageCount: number;
  buffer: ArrayBuffer;
}

/** Split worker → main thread. */
export type SplitWorkerResponse =
  | { kind: 'progress'; id: string; progress: SplitProgress }
  | {
      kind: 'split-result';
      id: string;
      files: SplitWorkerFile[];
      verified: boolean;
    }
  | { kind: 'split-error'; id: string; error: SerializedError }
  | { kind: 'split-cancelled'; id: string };
