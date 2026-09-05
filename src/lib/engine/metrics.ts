import { isFinished } from "./engine";
import type { SessionState } from "./types";

/**
 * Pure metric selectors over engine state (PRD §9 — live values are the SAME
 * functions, called on every timer tick; nothing is computed only at the end).
 *
 * Formulas (standard typing-test convention, per the Phase 3 plan):
 * - Gross WPM = (total typed chars / 5) / elapsed minutes
 * - Accuracy  = correct keystrokes / total char keystrokes
 * - Error rate = incorrect keystrokes / total char keystrokes
 * - Backspaces are tracked separately (fix-ups) and excluded from accuracy.
 */

/** Elapsed active-session time. Frozen at `finishedAt` once complete. */
export function elapsedMs(state: SessionState, now: number): number {
  if (state.startedAt === null) return 0;
  const end = state.finishedAt ?? now;
  return Math.max(0, end - state.startedAt);
}

/** Total committed char keystrokes (correct + incorrect). */
export function typedChars(state: SessionState): number {
  return state.correctChars + state.incorrectChars;
}

/** Gross WPM. 0 before the first keystroke. */
export function wpm(state: SessionState, now: number): number {
  const minutes = elapsedMs(state, now) / 60_000;
  if (minutes <= 0) return 0;
  return typedChars(state) / 5 / minutes;
}

/** Accuracy %. 100 before any keystroke. */
export function accuracy(state: SessionState): number {
  const total = typedChars(state);
  if (total === 0) return 100;
  return (state.correctChars / total) * 100;
}

/** Error rate % (errors per keystroke). 0 before any keystroke. */
export function errorRate(state: SessionState): number {
  const total = typedChars(state);
  if (total === 0) return 0;
  return (state.incorrectChars / total) * 100;
}

/** Completion percentage of the lesson buffer (0-100). */
export function progressPct(state: SessionState): number {
  if (state.entries.length === 0) return 100;
  return (state.position / state.entries.length) * 100;
}

/** Next expected character (null when finished). */
export function nextChar(state: SessionState): string | null {
  return isFinished(state) ? null : (state.entries[state.position]?.expected ?? null);
}

/** All live metrics in one selector — the seven §9 values. */
export interface LiveMetrics {
  wpm: number;
  accuracy: number;
  errorRate: number;
  correctChars: number;
  incorrectChars: number;
  totalChars: number;
  backspaceCount: number;
  elapsedMs: number;
  progressPct: number;
  finished: boolean;
}

export function liveMetrics(state: SessionState, now: number): LiveMetrics {
  return {
    wpm: wpm(state, now),
    accuracy: accuracy(state),
    errorRate: errorRate(state),
    correctChars: state.correctChars,
    incorrectChars: state.incorrectChars,
    totalChars: typedChars(state),
    backspaceCount: state.backspaceCount,
    elapsedMs: elapsedMs(state, now),
    progressPct: progressPct(state),
    finished: isFinished(state),
  };
}
