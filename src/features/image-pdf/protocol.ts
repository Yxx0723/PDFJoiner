import type { SerializedError } from '@/features/pdf/protocol';
import type { ImageJob, ImagePdfProgress, ImagePdfSettings, PageSummary } from './types';

/** Main thread → image worker. */
export type ImageWorkerRequest =
  | { kind: 'build'; id: string; jobs: ImageJob[]; settings: ImagePdfSettings }
  | { kind: 'cancel'; id: string };

/** Image worker → main thread. */
export type ImageWorkerResponse =
  | { kind: 'progress'; id: string; progress: ImagePdfProgress }
  | {
      kind: 'result';
      id: string;
      buffer: ArrayBuffer;
      pageCount: number;
      verified: boolean;
      pages: PageSummary[];
    }
  | { kind: 'error'; id: string; error: SerializedError }
  | { kind: 'cancelled'; id: string };
