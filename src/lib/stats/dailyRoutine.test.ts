import { describe, expect, it } from "vitest";

import {
  clearRoutine,
  dashboardEnterAction,
  deriveRoutine,
  pickSprintLesson,
  readRoutine,
  readRoutineForDay,
  routineStorageKey,
  streakEncouragement,
  writeRoutine,
  type DeriveRoutineInput,
  type RoutineAttempt,
  type RoutineStepId,
  type RoutineStatus,
  type RoutineStorage,
} from "./dailyRoutine";

/**
 * Daily Routine tests (UX plan §5.1 / §5.4).
 *
 * Two halves: the localStorage clock (per-day key, tolerant JSON, wrong-day
 * entries read as absent — the midnight rollover) and the pure state machine
 * (skip rules per step, `finishedAt >= startedAt` boundary, wrong-kind
 * attempts never counting, Enter precedence and the §5.2 copy tiers).
 */

const DAY = "2026-09-26";
const YESTERDAY = "2026-09-25";
const START = 1_770_000_000_000;

function memoryStorage(initial: Record<string, string> = {}): RoutineStorage & {
  keys: () => string[];
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

function attempt(
  kind: RoutineAttempt["kind"],
  finishedAt: number,
  lessonId: string | null = null,
): RoutineAttempt {
  return { kind, finishedAt, lessonId };
}

function baseInput(overrides: Partial<DeriveRoutineInput> = {}): DeriveRoutineInput {
  return {
    startedAt: START,
    dayKey: DAY,
    attemptsSinceStart: [],
    adaptiveEnabled: true,
    analysisAvailable: true,
    completedLessonCount: 1,
    sprintLessonId: "l1-001",
    masteredLessonIds: ["l1-001"],
    ...overrides,
  };
}

function stepOf(status: RoutineStatus, id: RoutineStepId) {
  const step = status.steps.find((s) => s.id === id);
  expect(step).toBeDefined();
  return step!;
}

const statesOf = (status: RoutineStatus) =>
  status.steps.map((step) => `${step.id}:${step.state}`);

/* ------------------------------- persistence ----------------------------- */

describe("routine localStorage clock", () => {
  it("builds one key per local calendar day", () => {
    expect(routineStorageKey(DAY)).toBe("typekernel.routine.2026-09-26");
    expect(routineStorageKey(YESTERDAY)).not.toBe(routineStorageKey(DAY));
  });

  it("round-trips an entry through its day key", () => {
    const storage = memoryStorage();
    writeRoutine({ dayKey: DAY, startedAt: START }, storage);
    expect(storage.keys()).toEqual([routineStorageKey(DAY)]);
    expect(readRoutineForDay(DAY, storage)).toEqual({ dayKey: DAY, startedAt: START });
    expect(readRoutine(DAY, storage)).toEqual({ dayKey: DAY, startedAt: START });
  });

  it("treats a previous day's key as absent (midnight rollover)", () => {
    const storage = memoryStorage();
    writeRoutine({ dayKey: YESTERDAY, startedAt: START }, storage);
    expect(readRoutine(DAY, storage)).toBeNull();
    expect(readRoutineForDay(DAY, storage)).toBeNull();
    expect(readRoutineForDay(YESTERDAY, storage)).toEqual({
      dayKey: YESTERDAY,
      startedAt: START,
    });
  });

  it("reads a wrong-day payload as absent, tolerantly", () => {
    const storage = memoryStorage({
      [routineStorageKey(DAY)]: JSON.stringify({ dayKey: YESTERDAY, startedAt: START }),
    });
    // Raw read still surfaces the payload…
    expect(readRoutine(DAY, storage)).toEqual({ dayKey: YESTERDAY, startedAt: START });
    // …but the card's read path rejects it as a stale day.
    expect(readRoutineForDay(DAY, storage)).toBeNull();
  });

  it("never throws on bad JSON or wrong shapes", () => {
    const storage = memoryStorage({
      [routineStorageKey(DAY)]: "{not json",
      [routineStorageKey(YESTERDAY)]: JSON.stringify({ startedAt: START }),
    });
    expect(readRoutine(DAY, storage)).toBeNull();
    expect(readRoutineForDay(DAY, storage)).toBeNull();
    expect(readRoutine(YESTERDAY, storage)).toBeNull();
    expect(
      readRoutineForDay(
        "2026-09-24",
        memoryStorage({ "typekernel.routine.2026-09-24": JSON.stringify([1, 2, 3]) }),
      ),
    ).toBeNull();
    expect(
      readRoutineForDay(
        "2026-09-23",
        memoryStorage({
          "typekernel.routine.2026-09-23": JSON.stringify({ dayKey: "2026-09-23", startedAt: Infinity }),
        }),
      ),
    ).toBeNull();
  });

  it("clears one day's entry", () => {
    const storage = memoryStorage();
    writeRoutine({ dayKey: DAY, startedAt: START }, storage);
    clearRoutine(DAY, storage);
    expect(readRoutineForDay(DAY, storage)).toBeNull();
    expect(storage.keys()).toEqual([]);
  });

  it("no-ops without storage (node default)", () => {
    expect(readRoutine(DAY)).toBeNull();
    expect(readRoutineForDay(DAY)).toBeNull();
    expect(() => writeRoutine({ dayKey: DAY, startedAt: START })).not.toThrow();
    expect(() => clearRoutine(DAY)).not.toThrow();
  });
});

/* ------------------------------- derivation ------------------------------ */

describe("deriveRoutine — unstarted routine", () => {
  it("reports every runnable step pending and warmup as the start target", () => {
    const status = deriveRoutine(baseInput({ startedAt: null }));
    expect(statesOf(status)).toEqual([
      "warmup:pending",
      "frontier:pending",
      "sprint:pending",
    ]);
    expect(status.complete).toBe(false);
    expect(status.activeStepId).toBe("warmup");
    expect(status.startedAt).toBeNull();
    expect(status.dayKey).toBe(DAY);
  });

  it("skips past an unavailable warmup to the first available step", () => {
    const status = deriveRoutine(baseInput({ startedAt: null, adaptiveEnabled: false }));
    expect(statesOf(status)).toEqual([
      "warmup:skipped",
      "frontier:pending",
      "sprint:pending",
    ]);
    expect(status.activeStepId).toBe("frontier");
    expect(status.complete).toBe(false);
  });

  it("cannot be complete before it starts, even with every step skipped", () => {
    const status = deriveRoutine(
      baseInput({
        startedAt: null,
        adaptiveEnabled: false,
        completedLessonCount: 0,
        sprintLessonId: null,
        masteredLessonIds: [],
      }),
    );
    expect(statesOf(status)).toEqual([
      "warmup:skipped",
      "frontier:pending",
      "sprint:skipped",
    ]);
    expect(status.complete).toBe(false);
  });
});

describe("deriveRoutine — warmup step", () => {
  it("skips with the Settings reason when adaptive drills are off", () => {
    const status = deriveRoutine(baseInput({ adaptiveEnabled: false }));
    expect(stepOf(status, "warmup").state).toBe("skipped");
    expect(stepOf(status, "warmup").skipReason).toBe(
      "Adaptive drills are off in Settings",
    );
  });

  it("skips with the no-data reason before any weakness data exists", () => {
    const status = deriveRoutine(baseInput({ analysisAvailable: false }));
    expect(stepOf(status, "warmup").state).toBe("skipped");
    expect(stepOf(status, "warmup").skipReason).toBe("No weakness data yet");
  });

  it("completes on one weakness attempt finished after the start", () => {
    const status = deriveRoutine(
      baseInput({ attemptsSinceStart: [attempt("weakness", START + 1)] }),
    );
    expect(stepOf(status, "warmup").state).toBe("done");
  });

  it("honours the finishedAt >= startedAt boundary exactly", () => {
    expect(
      stepOf(
        deriveRoutine(baseInput({ attemptsSinceStart: [attempt("weakness", START)] })),
        "warmup",
      ).state,
    ).toBe("done");
    expect(
      stepOf(
        deriveRoutine(
          baseInput({ attemptsSinceStart: [attempt("weakness", START - 1)] }),
        ),
        "warmup",
      ).state,
    ).toBe("pending");
  });

  it("ignores non-weakness attempts", () => {
    const status = deriveRoutine(
      baseInput({
        attemptsSinceStart: [
          attempt("lesson", START + 1, "l1-001"),
          attempt("adaptive", START + 1),
          attempt("custom", START + 1, "custom-1"),
        ],
      }),
    );
    expect(stepOf(status, "warmup").state).toBe("pending");
  });
});

describe("deriveRoutine — frontier step", () => {
  it("needs exactly two lesson attempts after the start", () => {
    expect(
      stepOf(
        deriveRoutine(
          baseInput({
            attemptsSinceStart: [attempt("lesson", START + 1, "l1-001")],
          }),
        ),
        "frontier",
      ).state,
    ).toBe("pending");
    expect(
      stepOf(
        deriveRoutine(
          baseInput({
            attemptsSinceStart: [
              attempt("lesson", START + 1, "l1-001"),
              attempt("lesson", START + 2, "l1-002"),
            ],
          }),
        ),
        "frontier",
      ).state,
    ).toBe("done");
  });

  it("counts lesson attempts regardless of pass, lesson or mastery", () => {
    const status = deriveRoutine(
      baseInput({
        attemptsSinceStart: [
          attempt("lesson", START + 1, "l1-001"),
          attempt("lesson", START + 2, "l2-004"),
        ],
      }),
    );
    expect(stepOf(status, "frontier").state).toBe("done");
  });

  it("never counts custom, weakness, adaptive or pre-start lesson rows", () => {
    const status = deriveRoutine(
      baseInput({
        attemptsSinceStart: [
          attempt("custom", START + 1, "custom-1"),
          attempt("weakness", START + 2),
          attempt("adaptive", START + 3),
          attempt("lesson", START - 5, "l1-001"),
        ],
      }),
    );
    expect(stepOf(status, "frontier").state).toBe("pending");
  });

  it("is never skipped", () => {
    const status = deriveRoutine(
      baseInput({
        adaptiveEnabled: false,
        analysisAvailable: false,
        completedLessonCount: 0,
        sprintLessonId: null,
        masteredLessonIds: [],
      }),
    );
    expect(stepOf(status, "frontier").state).toBe("pending");
    expect(stepOf(status, "frontier").skipReason).toBeUndefined();
  });
});

describe("deriveRoutine — sprint step", () => {
  it("skips without a mastered lesson, with the unlock reason", () => {
    const status = deriveRoutine(
      baseInput({ completedLessonCount: 0, sprintLessonId: null, masteredLessonIds: [] }),
    );
    expect(stepOf(status, "sprint").state).toBe("skipped");
    expect(stepOf(status, "sprint").skipReason).toBe(
      "Master a lesson to unlock speed sprints",
    );
  });

  it("completes on a lesson attempt against a mastered lesson", () => {
    const status = deriveRoutine(
      baseInput({ attemptsSinceStart: [attempt("lesson", START + 1, "l1-001")] }),
    );
    expect(stepOf(status, "sprint").state).toBe("done");
  });

  it("stays pending on a non-mastered lesson or a wrong kind", () => {
    expect(
      stepOf(
        deriveRoutine(
          baseInput({
            masteredLessonIds: ["l3-014"],
            attemptsSinceStart: [attempt("lesson", START + 1, "l1-001")],
          }),
        ),
        "sprint",
      ).state,
    ).toBe("pending");
    expect(
      stepOf(
        deriveRoutine(
          baseInput({ attemptsSinceStart: [attempt("weakness", START + 1)] }),
        ),
        "sprint",
      ).state,
    ).toBe("pending");
    expect(
      stepOf(
        deriveRoutine(
          baseInput({ attemptsSinceStart: [attempt("lesson", START - 1, "l1-001")] }),
        ),
        "sprint",
      ).state,
    ).toBe("pending");
  });
});

describe("deriveRoutine — completeness and the active step", () => {
  it("is complete when the skippable steps are skipped and the rest is done", () => {
    const status = deriveRoutine(
      baseInput({
        adaptiveEnabled: false,
        completedLessonCount: 0,
        sprintLessonId: null,
        masteredLessonIds: [],
        attemptsSinceStart: [
          attempt("lesson", START + 1, "l1-001"),
          attempt("lesson", START + 2, "l1-001"),
        ],
      }),
    );
    expect(statesOf(status)).toEqual([
      "warmup:skipped",
      "frontier:done",
      "sprint:skipped",
    ]);
    expect(status.complete).toBe(true);
    expect(status.activeStepId).toBeNull();
  });

  it("stays incomplete while any step is pending and walks the order", () => {
    const one = deriveRoutine(
      baseInput({ attemptsSinceStart: [attempt("weakness", START + 1)] }),
    );
    expect(one.complete).toBe(false);
    expect(one.activeStepId).toBe("frontier");

    const two = deriveRoutine(
      baseInput({
        attemptsSinceStart: [
          attempt("weakness", START + 1),
          attempt("lesson", START + 2, "l1-002"),
          attempt("lesson", START + 3, "l1-003"),
        ],
      }),
    );
    expect(two.activeStepId).toBe("sprint");

    const all = deriveRoutine(
      baseInput({
        attemptsSinceStart: [
          attempt("weakness", START + 1),
          attempt("lesson", START + 2, "l1-002"),
          attempt("lesson", START + 3, "l1-003"),
          attempt("lesson", START + 4, "l1-001"),
        ],
      }),
    );
    expect(all.complete).toBe(true);
    expect(all.activeStepId).toBeNull();
  });
});

/* ----------------------------- Enter precedence -------------------------- */

describe("dashboardEnterAction", () => {
  const started = deriveRoutine(baseInput());
  // Warmup done, frontier done, sprint still pending (the lesson attempts
  // landed on a non-mastered module) — started but far from complete.
  const incomplete = deriveRoutine(
    baseInput({
      attemptsSinceStart: [
        attempt("weakness", START + 1),
        attempt("lesson", START + 2, "l1-002"),
        attempt("lesson", START + 3, "l1-003"),
      ],
    }),
  );

  it("always starts an unstarted routine", () => {
    const unstarted = deriveRoutine(baseInput({ startedAt: null }));
    expect(dashboardEnterAction(unstarted, true)).toBe("start-routine");
    expect(dashboardEnterAction(unstarted, false)).toBe("start-routine");
  });

  it("continues a started, incomplete routine with or without a lesson", () => {
    expect(dashboardEnterAction(started, true)).toBe("continue-routine");
    expect(dashboardEnterAction(started, false)).toBe("continue-routine");
    expect(incomplete.complete).toBe(false);
    expect(incomplete.activeStepId).not.toBeNull();
    expect(dashboardEnterAction(incomplete, true)).toBe("continue-routine");
    expect(dashboardEnterAction(incomplete, false)).toBe("continue-routine");
  });

  it("hands Enter back to the frontier only once complete", () => {
    const done = deriveRoutine(
      baseInput({
        adaptiveEnabled: false,
        completedLessonCount: 0,
        sprintLessonId: null,
        masteredLessonIds: [],
        attemptsSinceStart: [
          attempt("lesson", START + 1, "l1-001"),
          attempt("lesson", START + 2, "l1-001"),
        ],
      }),
    );
    expect(done.complete).toBe(true);
    expect(dashboardEnterAction(done, true)).toBe("resume-frontier");
    expect(dashboardEnterAction(done, false)).toBe("none");
  });
});

/* ------------------------------- sprint pick ----------------------------- */

describe("pickSprintLesson", () => {
  it("returns null when nothing is mastered", () => {
    expect(pickSprintLesson([])).toBeNull();
  });

  it("picks the highest bestWpm", () => {
    expect(
      pickSprintLesson([
        { id: "l1-001", bestWpm: 48 },
        { id: "l2-003", bestWpm: 92 },
        { id: "l3-014", bestWpm: 71 },
      ]),
    ).toEqual({ id: "l2-003", bestWpm: 92 });
  });

  it("breaks ties toward the lowest list order", () => {
    expect(
      pickSprintLesson([
        { id: "l1-001", bestWpm: 60 },
        { id: "l1-002", bestWpm: 60 },
        { id: "l1-003", bestWpm: 60 },
      ]),
    ).toEqual({ id: "l1-001", bestWpm: 60 });
  });
});

/* ---------------------------- §5.2 encouragement ------------------------- */

describe("streakEncouragement", () => {
  const RULE =
    "Streaks count consecutive days with at least 1 finished attempt. Goals missing never break streaks.";

  it("opens a cold streak", () => {
    expect(streakEncouragement(0)).toEqual({
      headline: "Start your streak today",
      detail: `Finish one attempt to light the fire. ${RULE}`,
    });
  });

  it("celebrates day one and day two", () => {
    expect(streakEncouragement(1)).toEqual({
      headline: "Day 1 — locked in",
      detail: `One more day tomorrow builds the habit. ${RULE}`,
    });
    const two = streakEncouragement(2);
    expect(two.headline).toBe("2-Day Streak");
    expect(two.detail).toContain("top 30%");
    expect(two.detail).toContain(RULE);
  });

  it("applies the top-20% band to 3–6 days with the real count", () => {
    for (const days of [3, 4, 5, 6]) {
      const copy = streakEncouragement(days);
      expect(copy.headline).toBe(
        `${days}-Day Streak: You're in the top 20% of consistent typists!`,
      );
      expect(copy.detail).toContain(RULE);
    }
  });

  it("switches to the top-10% band at a week and the top-1% band at 30", () => {
    expect(streakEncouragement(7).headline).toBe(
      "7-Day Streak: top 10% territory — most typists never make it past a week.",
    );
    expect(streakEncouragement(29).headline).toContain("29-Day Streak: top 10%");
    expect(streakEncouragement(30).headline).toBe(
      "30-Day Streak: top 1% discipline — that's a serious habit.",
    );
    expect(streakEncouragement(400).headline).toContain("400-Day Streak: top 1%");
    expect(streakEncouragement(29).detail).toBe(RULE);
    expect(streakEncouragement(30).detail).toBe(RULE);
  });

  it("always explains what a streak counts", () => {
    for (const days of [0, 1, 2, 3, 7, 30, 90]) {
      expect(streakEncouragement(days).detail).toContain(RULE);
    }
    expect(streakEncouragement(-5).headline).toBe("Start your streak today");
    expect(streakEncouragement(3.9).headline).toContain("3-Day Streak");
  });
});
