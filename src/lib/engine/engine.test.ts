import { describe, expect, it } from "vitest";

import { applyEvent, createSession, isFinished } from "./engine";
import { liveMetrics } from "./metrics";
import type { SessionState } from "./types";

const char = (c: string) => ({ type: "char" as const, char: c });
const BACKSPACE = { type: "backspace" as const };

/** Feeds events with increasing timestamps (step ms apart, from `start`). */
function run(
  content: string,
  inputs: Array<{ type: "char"; char: string } | { type: "backspace" }>,
  start = 1_000,
  step = 100,
): SessionState {
  let state = createSession(content);
  inputs.forEach((event, i) => {
    state = applyEvent(state, event, start + i * step);
  });
  return state;
}

describe("createSession", () => {
  it("creates a pending, untouched state", () => {
    const state = createSession("ab\nc");
    expect(state.position).toBe(0);
    expect(state.entries).toHaveLength(4);
    expect(state.entries.every((e) => e.status === "pending")).toBe(true);
    expect(state.startedAt).toBeNull();
    expect(state.finishedAt).toBeNull();
    expect(state.correctChars).toBe(0);
    expect(state.incorrectChars).toBe(0);
    expect(state.totalKeystrokes).toBe(0);
    expect(state.backspaceCount).toBe(0);
    expect(isFinished(state)).toBe(false);
  });

  it("handles an empty lesson buffer", () => {
    const state = createSession("");
    expect(state.entries).toHaveLength(0);
    // Metrics on an empty buffer: 100% progress, nothing else defined.
    expect(liveMetrics(state, Date.now()).progressPct).toBe(100);
    // Keystrokes on an empty buffer are ignored, not crashes.
    const after = applyEvent(state, char("x"), 5_000);
    expect(after).toBe(state);
  });
});

describe("applyEvent — perfect run", () => {
  it("marks every char correct and finishes", () => {
    const state = run("abc", [char("a"), char("b"), char("c")]);
    expect(state.entries.map((e) => e.status)).toEqual([
      "correct",
      "correct",
      "correct",
    ]);
    expect(state.position).toBe(3);
    expect(state.correctChars).toBe(3);
    expect(state.incorrectChars).toBe(0);
    expect(state.totalKeystrokes).toBe(3);
    expect(state.backspaceCount).toBe(0);
    expect(isFinished(state)).toBe(true);
    expect(state.finishedAt).toBe(1_000 + 2 * 100);
  });

  it("captures inter-key latency per keystroke", () => {
    const state = run("abc", [char("a"), char("b"), char("c")]);
    expect(state.keyEvents.map((k) => k.latencyMs)).toEqual([0, 100, 100]);
    expect(state.keyEvents.map((k) => k.at)).toEqual([1000, 1100, 1200]);
  });

  it("records shift_required per expected char (US convention)", () => {
    const state = run("aA(9", [char("a"), char("A"), char("("), char("9")]);
    expect(state.keyEvents.map((k) => k.shiftRequired)).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe("applyEvent — wrong chars & backspace", () => {
  it("advances on a wrong char and marks it incorrect", () => {
    const state = run("abc", [char("X"), char("b"), char("c")]);
    expect(state.entries[0]).toEqual({
      expected: "a",
      typed: "X",
      status: "incorrect",
    });
    expect(state.position).toBe(3);
    expect(state.correctChars).toBe(2);
    expect(state.incorrectChars).toBe(1);
    expect(isFinished(state)).toBe(true);
  });

  it("backspace steps back, clears status and counts a fix-up", () => {
    const state = run("abc", [char("a"), char("X"), BACKSPACE, char("b")]);
    expect(state.position).toBe(2);
    expect(state.entries[0].status).toBe("correct");
    expect(state.entries[1].status).toBe("correct");
    expect(state.backspaceCount).toBe(1);
    // Cumulative keystroke counters keep the mistake (accuracy honesty):
    expect(state.correctChars).toBe(2);
    expect(state.incorrectChars).toBe(1);
    expect(state.totalKeystrokes).toBe(3);
  });

  it("backspace on an untouched buffer is a pure no-op", () => {
    const state = createSession("abc");
    const after = applyEvent(state, BACKSPACE, 5_000);
    expect(after).toBe(state);
  });

  it("a finished session is immutable to further events", () => {
    const state = run("ab", [char("a"), char("b")]);
    const after = applyEvent(state, char("c"), 99_999);
    expect(after).toBe(state);
    const afterBackspace = applyEvent(state, BACKSPACE, 99_999);
    expect(afterBackspace).toBe(state);
  });
});

describe("multi-line content", () => {
  it("treats Enter as the literal newline character", () => {
    const state = run("a\nb", [char("a"), { type: "char", char: "\n" }, char("b")]);
    expect(state.entries[1].expected).toBe("\n");
    expect(state.entries[1].typed).toBe("\n");
    expect(state.entries[1].status).toBe("correct");
    expect(isFinished(state)).toBe(true);
  });

  it("a wrong newline is an error and still advances", () => {
    const state = run("a\nb", [char("a"), char(" "), char("b")]);
    expect(state.entries[1].status).toBe("incorrect");
    expect(state.incorrectChars).toBe(1);
    expect(isFinished(state)).toBe(true);
  });
});
