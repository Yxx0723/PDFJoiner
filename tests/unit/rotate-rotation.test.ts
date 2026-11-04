import { describe, expect, it } from 'vitest';

import {
  addAngles,
  buildRotationJobs,
  countRotatedPages,
  finalRotation,
  normalizeAngle,
  resetDeltas,
  rotateDeltas,
  toRotationAngle,
} from '@/features/pdf-rotate/rotation';
import {
  canRedo,
  canUndo,
  createHistory,
  currentDeltas,
  pushHistory,
  redoHistory,
  undoHistory,
} from '@/features/pdf-rotate/history';

describe('angle arithmetic', () => {
  it('implements the quarter-turn table from the specification', () => {
    expect(addAngles(0, 90)).toBe(90);
    expect(addAngles(90, 90)).toBe(180);
    expect(addAngles(180, 90)).toBe(270);
    expect(addAngles(270, 90)).toBe(0);
    expect(addAngles(0, -90)).toBe(270);
    expect(addAngles(90, -90)).toBe(0);
  });

  it('normalises 360°, 450° and negative angles', () => {
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(-450)).toBe(270);
    expect(normalizeAngle(720 + 180)).toBe(180);
    expect(toRotationAngle(360)).toBe(0);
    expect(toRotationAngle(-90)).toBe(270);
  });

  it('rejects angles that are not quarter turns, and non-finite values', () => {
    expect(() => toRotationAngle(45)).toThrow(/90°/);
    expect(() => toRotationAngle(360 + 30)).toThrow();
    expect(() => normalizeAngle(Number.NaN)).toThrow();
    expect(() => addAngles(90, 33)).toThrow();
  });

  it('finalRotation keeps the source rotation instead of overwriting it', () => {
    // A source page already rotated 90°, turned clockwise once, must end at 180°.
    expect(finalRotation(90, 90)).toBe(180);
    expect(finalRotation(270, 90)).toBe(0);
    expect(finalRotation(180, 0)).toBe(180);
    expect(finalRotation(0, 180)).toBe(180);
  });
});

describe('page-level rotation plans', () => {
  const base = [0, 0, 0, 0, 0];

  it('rotates one page without touching its neighbours', () => {
    expect(rotateDeltas(base, [2], 90)).toEqual([0, 0, 90, 0, 0]);
  });

  it('rotates several pages, a range and all pages', () => {
    expect(rotateDeltas(base, [0, 3], -90)).toEqual([270, 0, 0, 270, 0]);
    expect(rotateDeltas(base, [1, 2, 3], 180)).toEqual([0, 180, 180, 180, 0]);
    expect(rotateDeltas(base, [0, 1, 2, 3, 4], 90)).toEqual([90, 90, 90, 90, 90]);
  });

  it('collapses duplicate indices within one operation', () => {
    // A range expression may repeat a page; one click must rotate it once.
    expect(rotateDeltas(base, [1, 1, 2, 2], 90)).toEqual([0, 90, 90, 0, 0]);
  });

  it('accumulates repeated operations on the same page', () => {
    const first = rotateDeltas(base, [1], 90);
    const second = rotateDeltas(first, [1], 90);
    const third = rotateDeltas(second, [1], -90);
    expect(first[1]).toBe(90);
    expect(second[1]).toBe(180);
    expect(third[1]).toBe(90);
  });

  it('refuses out-of-range page indices', () => {
    expect(() => rotateDeltas(base, [5], 90)).toThrow(/超出范围/);
    expect(() => rotateDeltas(base, [-1], 90)).toThrow(/超出范围/);
    expect(() => resetDeltas(base, [99])).toThrow(/超出范围/);
  });

  it('resets one page and all pages back to the imported direction', () => {
    const changed = [90, 180, 270, 0, 90];
    expect(resetDeltas(changed, [0, 2])).toEqual([0, 180, 0, 0, 90]);
    expect(resetDeltas(changed, [0, 1, 2, 3, 4])).toEqual([0, 0, 0, 0, 0]);
  });

  it('counts only pages whose delta is non-zero', () => {
    expect(countRotatedPages([0, 90, 0, 270])).toBe(2);
    expect(countRotatedPages([0, 0, 0])).toBe(0);
  });

  it('builds one final-angle job per page, preserving original rotations', () => {
    expect(buildRotationJobs([0, 90, 180, 270], [90, 90, 0, 270])).toEqual([
      { pageIndex: 0, finalAngle: 90 },
      { pageIndex: 1, finalAngle: 180 },
      { pageIndex: 2, finalAngle: 180 },
      { pageIndex: 3, finalAngle: 180 },
    ]);
    expect(() => buildRotationJobs([0, 0], [0])).toThrow(/不一致/);
  });
});

describe('undo / redo history', () => {
  it('starts with exactly one snapshot and no undo available', () => {
    const history = createHistory([0, 0, 0]);
    expect(currentDeltas(history)).toEqual([0, 0, 0]);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });

  it('undoes and redoes successive rotations of the same page', () => {
    let history = createHistory([0, 0, 0]);
    history = pushHistory(history, [0, 90, 0]);
    history = pushHistory(history, [0, 180, 0]);
    history = pushHistory(history, [0, 270, 0]);

    expect(currentDeltas(history)).toEqual([0, 270, 0]);
    history = undoHistory(history);
    expect(currentDeltas(history)).toEqual([0, 180, 0]);
    history = undoHistory(history);
    expect(currentDeltas(history)).toEqual([0, 90, 0]);
    history = undoHistory(history);
    expect(currentDeltas(history)).toEqual([0, 0, 0]);
    expect(canUndo(history)).toBe(false);

    history = redoHistory(history);
    history = redoHistory(history);
    expect(currentDeltas(history)).toEqual([0, 180, 0]);
    expect(canRedo(history)).toBe(true);
  });

  it('a new operation discards the redo branch', () => {
    let history = createHistory([0]);
    history = pushHistory(history, [90]);
    history = pushHistory(history, [180]);
    history = undoHistory(history);
    history = pushHistory(history, [270]);

    expect(currentDeltas(history)).toEqual([270]);
    expect(canRedo(history)).toBe(false);
    expect(history.entries).toHaveLength(3);
  });

  it('ignores a no-op push and keeps the snapshot reference stable', () => {
    const history = createHistory([0, 90]);
    expect(pushHistory(history, [0, 90])).toBe(history);
  });

  it('caps the stack without losing the current state', () => {
    let history = createHistory([0], 4);
    for (let step = 1; step <= 12; step += 1) {
      history = pushHistory(history, [(step * 90) % 360]);
    }
    expect(history.entries).toHaveLength(4);
    expect(history.index).toBe(3);
    expect(currentDeltas(history)).toEqual([(12 * 90) % 360]);
    expect(canUndo(history)).toBe(true);
  });

  it('undo/redo at the boundaries is a no-op', () => {
    const history = createHistory([0]);
    expect(undoHistory(history)).toBe(history);
    expect(redoHistory(history)).toBe(history);
  });
});
