import type { SerializedError } from '@/features/pdf/protocol';
import type { RotateInspection, RotateProgress, RotationAngle, RotationJob } from './types';

/** Main thread → rotation worker. */
export type RotateWorkerRequest =
  | { kind: 'inspect'; id: string; buffer: ArrayBuffer }
  | { kind: 'rotate'; id: string; buffer: ArrayBuffer; jobs: RotationJob[] }
  | { kind: 'cancel'; id: string };

/** Rotation worker → main thread. */
export type RotateWorkerResponse =
  | { kind: 'inspect-result'; id: string; result: RotateInspection }
  | { kind: 'inspect-error'; id: string; error: SerializedError }
  | { kind: 'progress'; id: string; progress: RotateProgress }
  | {
      kind: 'rotate-result';
      id: string;
      buffer: ArrayBuffer;
      pageCount: number;
      rotations: RotationAngle[];
      verified: boolean;
    }
  | { kind: 'rotate-error'; id: string; error: SerializedError }
  | { kind: 'rotate-cancelled'; id: string };
