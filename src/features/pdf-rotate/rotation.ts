/**
 * Pure rotation arithmetic.
 *
 * Three distinct values must never be confused:
 *  - `original`  — the page's `/Rotate` as read from the source PDF;
 *  - `delta`     — what the user added in this session (0 when untouched);
 *  - `final`     — `normalize(original + delta)`, the angle written on export.
 *
 * Keeping this module DOM-free and pdf-lib-free makes the whole decision table
 * directly unit-testable, and the worker/store/UI all share exactly one formula.
 */

import type { RotationAngle, RotationJob } from './types';

export const VALID_ANGLES: readonly RotationAngle[] = [0, 90, 180, 270];

/** `((angle % 360) + 360) % 360`, rejecting non-finite input. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) throw new RangeError('旋转角度必须是有限数字。');
  return ((angle % 360) + 360) % 360;
}

export function isRotationAngle(angle: number): angle is RotationAngle {
  return angle === 0 || angle === 90 || angle === 180 || angle === 270;
}

/** Normalises and validates, throwing on e.g. 45° or 360°. */
export function toRotationAngle(angle: number): RotationAngle {
  const normalized = normalizeAngle(angle);
  if (!isRotationAngle(normalized)) {
    throw new RangeError(
      `不支持的旋转角度 ${angle}°。PDF 页面的 /Rotate 只能是 0°、90°、180° 或 270°。`,
    );
  }
  return normalized;
}

/** Adds two rotations, e.g. `270 + 90 = 0` and `0 - 90 = 270`. */
export function addAngles(a: number, b: number): RotationAngle {
  return toRotationAngle(toRotationAngle(a) + toRotationAngle(b));
}

/** The angle the exported page must carry. */
export function finalRotation(original: number, delta: number): RotationAngle {
  return addAngles(original, delta);
}

function assertIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new RangeError(`页面索引 ${index} 超出范围（共 ${length} 页）。`);
  }
}

/**
 * Applies one relative step to the listed pages. Duplicate indices collapse to
 * a single step: one batch operation rotates each page exactly once.
 */
export function rotateDeltas(
  deltas: readonly number[],
  indices: readonly number[],
  delta: number,
): RotationAngle[] {
  const step = toRotationAngle(delta);
  const next = deltas.map(toRotationAngle);
  for (const index of new Set(indices)) {
    assertIndex(index, next.length);
    next[index] = addAngles(next[index], step);
  }
  return next;
}

/** Restores the listed pages to the direction they had when imported. */
export function resetDeltas(
  deltas: readonly number[],
  indices: readonly number[],
): RotationAngle[] {
  const next = deltas.map(toRotationAngle);
  for (const index of new Set(indices)) {
    assertIndex(index, next.length);
    next[index] = 0;
  }
  return next;
}

export function countRotatedPages(deltas: readonly number[]): number {
  return deltas.filter((delta) => toRotationAngle(delta) !== 0).length;
}

/** Full per-page export plan. Every page gets a job, even unchanged ones. */
export function buildRotationJobs(
  originals: readonly number[],
  deltas: readonly number[],
): RotationJob[] {
  if (originals.length !== deltas.length) {
    throw new RangeError(
      `页面数（${originals.length}）与旋转状态数（${deltas.length}）不一致。`,
    );
  }
  return originals.map((original, pageIndex) => ({
    pageIndex,
    finalAngle: finalRotation(original, deltas[pageIndex]),
  }));
}
