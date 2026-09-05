import { describe, expect, it } from "vitest";

import { applyEvent, createSession } from "./engine";
import { liveMetrics } from "./metrics";

const char = (c: string) => ({ type: "char" as const, char: c });
const BACKSPACE = { type: "backspace" as const };

/** Feeds events with increasing timestamps (step ms apart, from `start`). */
function run(
  content: string,
  inputs: Array<{ type: "char"; char: string } | { type: "backspace" }>,
  start = 1_000,
  step = 100,
): ReturnType<typeof createSession> {
  let state = createSession(content);
  inputs.forEach((event, i) => {
    state = applyEvent(state, event, start + i * step);
  });
  return state;
}

describe("metrics — hand-computed WPM/accuracy", () => {
  // 25 chars typed over exactly 30 seconds:
  //   WPM = (25 / 5) / (30_000 ms / 60_000) = 5 words / 0.5 min = 10
  const content = "x".repeat(25);
  const inputs = Array.from({ length: 25 }, () => char("x"));
  const state = run(content, inputs, 1_000, 1_250); // last keystroke at t=31_000

  it("computes gross WPM exactly", () => {
    expect(liveMetrics(state, 31_000).elapsedMs).toBe(30_000);
    expect(liveMetrics(state, 31_000).wpm).toBeCloseTo(10, 10);
  });

  it("freezes elapsed time at finish and keeps WPM stable afterwards", () => {
    expect(liveMetrics(state, 300_000).elapsedMs).toBe(30_000);
    expect(liveMetrics(state, 300_000).wpm).toBeCloseTo(10, 10);
  });

  it("computes accuracy / error rate from keystroke outcomes", () => {
    // "abcde": 5 correct + 1 wrong 'X' (never corrected) = 6 keystrokes
    const state = run("abcde", [
      char("a"),
      char("b"),
      char("X"), // wrong at position 2
      char("d"),
      char("e"),
    ]);
    const metrics = liveMetrics(state, 10_000);
    expect(metrics.correctChars).toBe(4);
    expect(metrics.incorrectChars).toBe(1);
    expect(metrics.totalChars).toBe(5);
    expect(metrics.accuracy).toBeCloseTo((4 / 5) * 100, 10);
    expect(metrics.errorRate).toBeCloseTo(20, 10);
  });

  it("penalises corrected mistakes via backspaces on live accuracy", () => {
    // a correct, X wrong, backspace, b correct: 2 correct / 3 keystrokes
    const state = run("abcd", [char("a"), char("X"), BACKSPACE, char("b")]);
    const metrics = liveMetrics(state, 10_000);
    expect(metrics.backspaceCount).toBe(1);
    expect(metrics.accuracy).toBeCloseTo((2 / 3) * 100, 10);
  });

  it("returns neutral values before the first keystroke", () => {
    const state = createSession("abc");
    const metrics = liveMetrics(state, 50_000);
    expect(metrics.wpm).toBe(0);
    expect(metrics.accuracy).toBe(100);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.elapsedMs).toBe(0);
    expect(metrics.progressPct).toBe(0);
  });

  it("computes progress percentage", () => {
    const state = run("abcd", [char("a"), char("b")]);
    expect(liveMetrics(state, 5_000).progressPct).toBeCloseTo(50, 10);
  });

  it("zero WPM when all keystrokes land in the same millisecond", () => {
    const state = run("ab", [char("a"), char("b")], 1_000, 0);
    expect(liveMetrics(state, 1_000).wpm).toBe(0);
  });
});
