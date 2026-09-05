import type {
  CharEntry,
  InputEvent,
  KeyPerformance,
  SessionState,
} from "./types";
import type { SessionOptions } from "./types";

/**
 * Pure event-sourced typing engine (PRD §9). Reducer semantics:
 *
 * - A char keystroke is evaluated against the current position and ALWAYS
 *   advances (a wrong char is marked incorrect and still moves on, mirroring
 *   the design's inline error highlighting).
 * - Backspace steps back, resets that cell to pending, and counts as a
 *   fix-up; it is NOT a keystroke in the accuracy denominator.
 * - The session finishes when the last char is committed; further events are
 *   ignored (a finished attempt is immutable).
 */

/** ASCII/US characters produced with Shift held (complements uppercase). */
const SHIFTED_SYMBOLS = new Set([
  "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")",
  "_", "+", "{", "}", "|", ":", '"', "<", ">", "?",
]);

export const defaultRequiresShift = (char: string): boolean =>
  char !== char.toLowerCase() || SHIFTED_SYMBOLS.has(char);

export function isFinished(state: SessionState): boolean {
  return state.finishedAt !== null;
}

/** Creates the initial state for `content` (real `\n` newlines supported). */
export function createSession(content: string): SessionState {
  const entries: CharEntry[] = Array.from(content).map((expected) => ({
    expected,
    typed: null,
    status: "pending",
  }));
  return {
    content,
    position: 0,
    entries,
    correctChars: 0,
    incorrectChars: 0,
    totalKeystrokes: 0,
    backspaceCount: 0,
    keyEvents: [],
    startedAt: null,
    finishedAt: null,
  };
}

/** Folds one input event into a new immutable state (`now` = epoch ms). */
export function applyEvent(
  state: SessionState,
  event: InputEvent,
  now: number,
  options: SessionOptions = {},
): SessionState {
  const requiresShift = options.requiresShift ?? defaultRequiresShift;

  // A finished session is immutable — no events apply anymore.
  if (state.finishedAt !== null) return state;

  if (event.type === "backspace") {
    // Backspace on an untouched buffer is a no-op (nothing to fix up).
    if (state.position === 0) return state;
    const position = state.position - 1;
    const entries = state.entries.slice();
    entries[position] = {
      expected: entries[position].expected,
      typed: null,
      status: "pending",
    };
    return {
      ...state,
      position,
      entries,
      backspaceCount: state.backspaceCount + 1,
    };
  }

  const typed = event.char;
  if (typed.length !== 1) return state; // engine only accepts single chars
  if (state.position >= state.entries.length) return state; // empty buffer

  const expected = state.entries[state.position].expected;
  const correct = typed === expected;

  const lastEvent = state.keyEvents[state.keyEvents.length - 1];
  const latencyMs =
    lastEvent === undefined || state.startedAt === null
      ? 0
      : Math.max(0, now - lastEvent.at);

  const keyEvent: KeyPerformance = {
    expected,
    typed,
    correct,
    shiftRequired: requiresShift(expected),
    latencyMs,
    at: now,
  };

  const entries = state.entries.slice();
  const entry: CharEntry = {
    expected,
    typed,
    status: correct ? "correct" : "incorrect",
  };
  entries[state.position] = entry;

  const position = state.position + 1;
  const finished = position === entries.length;

  return {
    ...state,
    position,
    entries,
    correctChars: state.correctChars + (correct ? 1 : 0),
    incorrectChars: state.incorrectChars + (correct ? 0 : 1),
    totalKeystrokes: state.totalKeystrokes + 1,
    keyEvents: [...state.keyEvents, keyEvent],
    startedAt: state.startedAt ?? now,
    finishedAt: finished ? now : null,
  };
}
