/**
 * Pure typing-engine types (PRD §9).
 *
 * The engine is event-sourced and completely isolated: no DOM, no timers, no
 * Tauri. `createSession` produces an initial `SessionState`, `applyEvent`
 * folds `InputEvent`s into new immutable states, and all live metrics are
 * pure derivations (`metrics.ts`).
 */

/** User input events fed to the engine. Enter is the literal `\n` character. */
export type InputEvent =
  | { type: "char"; char: string }
  | { type: "backspace" };

export type CharStatus = "pending" | "correct" | "incorrect";

/** Per-character cell of the code buffer. */
export interface CharEntry {
  readonly expected: string;
  readonly typed: string | null;
  readonly status: CharStatus;
}

/** Recorded for every character-producing keystroke (feeds key statistics). */
export interface KeyPerformance {
  readonly expected: string;
  readonly typed: string;
  readonly correct: boolean;
  /** Whether the expected char needs Shift on the active layout. */
  readonly shiftRequired: boolean;
  /** Inter-key latency (ms since the previous char keystroke; 0 for the first). */
  readonly latencyMs: number;
  readonly at: number;
}

/** Immutable snapshot of a typing session. */
export interface SessionState {
  readonly content: string;
  readonly position: number;
  readonly entries: readonly CharEntry[];
  readonly correctChars: number;
  readonly incorrectChars: number;
  /** Character-producing keystrokes (chars incl. enter); backspaces excluded. */
  readonly totalKeystrokes: number;
  readonly backspaceCount: number;
  /** Per-keystroke performance buffer (persisted as key statistics on finish). */
  readonly keyEvents: readonly KeyPerformance[];
  readonly startedAt: number | null;
  /** Set when the last char of the content is committed. */
  readonly finishedAt: number | null;
}

/** §20 backspace policy (Settings → Training Preferences). */
export type BackspacePolicy = "counted" | "free" | "forbidden";

export interface SessionOptions {
  /**
   * Decides whether the *expected* char requires Shift. The default rule is
   * the ASCII/US convention (uppercase letters + shifted symbol set) — a
   * character-level fact, not a physical-key mapping; layouts stay in
   * `src/lib/layout/`. Override for alternative conventions.
   */
  requiresShift?: (char: string) => boolean;
  /**
   * Phase 7 wiring of the Settings backspace policy into the engine's
   * counting mode (default "counted" — the historical behavior):
   * - counted: backspace fixes the cell AND counts in `backspaceCount`;
   * - free: backspace fixes the cell but is NOT counted in the metrics;
   * - forbidden: backspace is a no-op (content can only move forward).
   */
  backspacePolicy?: BackspacePolicy;
}
