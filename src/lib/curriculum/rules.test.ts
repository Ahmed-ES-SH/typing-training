import { describe, expect, it } from "vitest";

import {
  ACCURACY_GATE,
  WPM_GATE,
  evaluateAttempt,
  gradeFor,
} from "./rules";

/**
 * Unlock-rule tests — the PRD §8 table verbatim plus the boundary cases
 * (Phase 4 plan §3.5).
 */

const attempt = (wpm: number, accuracy: number, completed = true) => ({
  wpm,
  accuracy,
  completed,
});

describe("PRD §8 unlock table (verbatim)", () => {
  it.each([
    [50, 93, "FAIL"],
    [44, 98, "FAIL"],
    [50, 95, "PASS"],
    [46, 97, "PASS"],
  ] as const)("%i WPM / %i%% -> %s", (wpm, accuracy, expected) => {
    expect(evaluateAttempt(attempt(wpm, accuracy))).toBe(expected);
  });
});

describe("§8 boundaries", () => {
  it("fails at exactly 45.0 WPM (gate is strictly greater-than)", () => {
    expect(WPM_GATE).toBe(45);
    expect(evaluateAttempt(attempt(45.0, 95))).toBe("FAIL");
    expect(evaluateAttempt(attempt(45.0001, 95))).toBe("PASS");
  });

  it("fails at 94.9% accuracy, passes at exactly 95%", () => {
    expect(ACCURACY_GATE).toBe(95);
    expect(evaluateAttempt(attempt(50, 94.9))).toBe("FAIL");
    expect(evaluateAttempt(attempt(50, 95))).toBe("PASS");
  });

  it("fails incomplete attempts regardless of numbers", () => {
    expect(evaluateAttempt(attempt(80, 100, false))).toBe("FAIL");
  });
});

describe("grades (presentational, never affect unlocking)", () => {
  it("grades passes S through C by speed and accuracy", () => {
    expect(gradeFor(attempt(70, 99))).toBe("S");
    expect(gradeFor(attempt(65, 98))).toBe("S");
    expect(gradeFor(attempt(64.9, 98))).toBe("A");
    expect(gradeFor(attempt(56, 97.2))).toBe("A");
    expect(gradeFor(attempt(55, 97))).toBe("A");
    expect(gradeFor(attempt(54.9, 97))).toBe("B");
    expect(gradeFor(attempt(50, 96))).toBe("B");
    expect(gradeFor(attempt(46, 95))).toBe("C");
  });

  it("grades fails D or F by accuracy only", () => {
    expect(gradeFor(attempt(80, 90))).toBe("D");
    expect(gradeFor(attempt(80, 89.9))).toBe("F");
    expect(gradeFor(attempt(30, 40))).toBe("F");
  });

  it("gives failing accuracy grades even at high speed", () => {
    expect(gradeFor(attempt(80, 93))).toBe("D");
  });
});
