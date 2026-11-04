/**
 * Undo / redo history for rotation deltas.
 *
 * A snapshot is the complete `rotationDeltas` array. Snapshots are small (one
 * number per page) and make "undo the last batch of 37 pages" trivially correct,
 * including repeated rotations of the same page. The stack is capped so a long
 * editing session cannot pin hundreds of arrays in memory.
 */

export interface RotationHistory {
  /** Snapshots, oldest first. `entries[index]` is the current state. */
  entries: number[][];
  index: number;
  limit: number;
}

export const DEFAULT_HISTORY_LIMIT = 60;

export function createHistory(
  deltas: readonly number[],
  limit = DEFAULT_HISTORY_LIMIT,
): RotationHistory {
  return { entries: [deltas.slice()], index: 0, limit: Math.max(2, limit) };
}

export function currentDeltas(history: RotationHistory): number[] {
  return history.entries[history.index] ?? [];
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Records a new state, dropping the redo branch. No-op states are ignored. */
export function pushHistory(
  history: RotationHistory,
  deltas: readonly number[],
): RotationHistory {
  const current = currentDeltas(history);
  if (same(current, deltas)) return history;

  const entries = [...history.entries.slice(0, history.index + 1), deltas.slice()];
  let index = entries.length - 1;

  // Drop the oldest snapshots, keeping `index` pointed at the same state.
  while (entries.length > history.limit) {
    entries.shift();
    index -= 1;
  }

  return { ...history, entries, index };
}

export function canUndo(history: RotationHistory): boolean {
  return history.index > 0;
}

export function canRedo(history: RotationHistory): boolean {
  return history.index < history.entries.length - 1;
}

export function undoHistory(history: RotationHistory): RotationHistory {
  return canUndo(history) ? { ...history, index: history.index - 1 } : history;
}

export function redoHistory(history: RotationHistory): RotationHistory {
  return canRedo(history) ? { ...history, index: history.index + 1 } : history;
}
