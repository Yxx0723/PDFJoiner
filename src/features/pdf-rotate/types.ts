/**
 * Shared types for the PDF rotation tool (V1.3).
 *
 * Kept free of runtime imports so both the worker and the main-thread store can
 * use them without pulling pdf-lib into the initial bundle.
 */

import type { PdfInspection } from '@/features/pdf/engine';

/** The only four legal values of a PDF page's `/Rotate` entry. */
export type RotationAngle = 0 | 90 | 180 | 270;

/** Which pages a batch rotation acts on. */
export type RotateScope = 'page' | 'selected' | 'range' | 'all';

export type RotateExportStatus = 'idle' | 'exporting' | 'success' | 'error' | 'cancelled';

export type RotateStage = 'loading' | 'applying' | 'saving' | 'verifying' | 'done';

/** Progress is reported in real processed pages, never as a fake percentage. */
export interface RotateProgress {
  stage: RotateStage;
  current: number;
  total: number;
}

/** One page's **final absolute** rotation, not a relative delta. */
export interface RotationJob {
  /** 0-based page index. */
  pageIndex: number;
  finalAngle: RotationAngle;
}

export interface RotateOutcome {
  bytes: Uint8Array;
  pageCount: number;
  /** Final absolute rotation of every page, in page order. */
  rotations: RotationAngle[];
  /** False when the output was too large to re-parse (reported honestly). */
  verified: boolean;
}

/** Everything the UI needs after importing a document, from a single parse. */
export interface RotateInspection {
  pageCount: number;
  /** Original `/Rotate` of every page, not just the first 60. */
  rotations: RotationAngle[];
  inspection: PdfInspection;
}
