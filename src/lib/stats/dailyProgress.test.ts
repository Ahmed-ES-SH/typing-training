import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CURRICULUM_LESSONS } from "../../content";
import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import {
  attemptsRepo,
  lessonsRepo,
  progressRepo,
  sessionsRepo,
} from "../db/repositories";
import { dailyGoalsRepo } from "./dailyGoalsRepo";
import {
  getConsistency,
  getTodayActuals,
  localDayKey,
  mergeProgress,
  metAllToday,
  startOfLocalDay,
  todayProgress,
} from "./dailyService";

/**
 * Goal-progress + consistency tests (Phase 8 plan §3.1, §5.1).
 *
 * Pure merge: disabled (0) goals are excluded from the met calculation, and
 * metAll requires at least one enabled goal. Fixture DB: session/progress
 * rows across three days must reconcile the 14-day strip's today cell with
 * `getTodayActuals`, honor a per-date override, and keep midnight-boundary
 * sessions on their local days.
 */

/** Local noon of `dayOffset` days from today — DST-safe day arithmetic. */
function noon(dayOffset: number): number {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

describe("mergeProgress (pure)", () => {
  it("meets only when every ENABLED goal is reached", () => {
    const goals = { minutesGoal: 15, lessonsGoal: 3, charsGoal: 500 };
    const full = mergeProgress(goals, { minutes: 20, lessonsDone: 3, charsTyped: 600 });
    expect(full.metAll).toBe(true);
    expect(full.metCount).toBe(3);

    const partial = mergeProgress(goals, { minutes: 20, lessonsDone: 1, charsTyped: 600 });
    expect(partial.metAll).toBe(false);
    expect(partial.metCount).toBe(2);
    expect(partial.lessons.met).toBe(false);
  });

  it("excludes disabled (0) goals from the met calculation", () => {
    const merged = mergeProgress(
      { minutesGoal: 0, lessonsGoal: 3, charsGoal: 0 },
      { minutes: 0, lessonsDone: 3, charsTyped: 0 },
    );
    expect(merged.enabledCount).toBe(1);
    expect(merged.metCount).toBe(1);
    expect(merged.metAll).toBe(true);
    expect(merged.minutes.disabled).toBe(true);
    expect(merged.chars.disabled).toBe(true);
  });

  it("never celebrates when every goal is disabled", () => {
    const merged = mergeProgress(
      { minutesGoal: 0, lessonsGoal: 0, charsGoal: 0 },
      { minutes: 99, lessonsDone: 9, charsTyped: 9999 },
    );
    expect(merged.enabledCount).toBe(0);
    expect(merged.metAll).toBe(false);
  });
});

describe("todayProgress / metAllToday / getConsistency (fixture DB)", () => {
  beforeAll(async () => {
    connectTestDb();
    for (const lesson of CURRICULUM_LESSONS.slice(0, 4)) {
      await lessonsRepo.upsert(lesson);
    }
    await dailyGoalsRepo.setDefaults({ minutesGoal: 15, lessonsGoal: 1, charsGoal: 100 });

    // Yesterday: a full training day (30 min session + completed lesson).
    const yStarted = noon(-1);
    await sessionsRepo.open({
      id: "phase8-yesterday",
      kind: "lesson",
      lessonId: "l1-001",
      startedAt: yStarted,
      endedAt: null,
      durationMs: null,
      charsTyped: 0,
    });
    await sessionsRepo.close("phase8-yesterday", yStarted + 30 * 60_000, 30 * 60_000, 400);
    const yAttempt = await attemptsRepo.insertWithNextNumber({
      lessonId: "l1-001",
      wpm: 50,
      accuracy: 96,
      errorRate: 4,
      errorCount: 2,
      correctChars: 380,
      incorrectChars: 20,
      backspaceCount: 3,
      durationMs: 120_000,
      completed: true,
      startedAt: yStarted,
      finishedAt: yStarted + 120_000,
    });
    void yAttempt;
    await progressRepo.upsert({
      lessonId: "l1-001",
      status: "completed",
      bestWpm: 50,
      bestAccuracy: 96,
      lowestErrorRate: 4,
      attemptCount: 1,
      unlockedAt: yStarted,
      completedAt: yStarted + 120_000,
      updatedAt: yStarted + 120_000,
    });

    // Today: a short session only (5 min, 50 chars, no completed lesson).
    const tStarted = Date.now() - 5 * 60_000;
    await sessionsRepo.open({
      id: "phase8-today",
      kind: "lesson",
      lessonId: "l1-002",
      startedAt: tStarted,
      endedAt: null,
      durationMs: null,
      charsTyped: 0,
    });
    await sessionsRepo.close("phase8-today", Date.now(), 5 * 60_000, 50);

    // A per-date override for today that only tracks lessons (0 disables).
    await dailyGoalsRepo.setOverride(localDayKey(Date.now()), {
      minutesGoal: 0,
      lessonsGoal: 1,
      charsGoal: 0,
    });
  });

  afterAll(() => {
    setDbForTests(null);
  });

  it("todayProgress honors the per-date override over defaults", async () => {
    const progress = await todayProgress();
    expect(progress.goals).toEqual({ minutesGoal: 0, lessonsGoal: 1, charsGoal: 0 });
    expect(progress.enabledCount).toBe(1);
    expect(progress.lessons.actual).toBe(0);
    expect(progress.metAll).toBe(false);
    expect(await metAllToday()).toBe(false);
  });

  it("disabling every goal clears the celebration without touching data", async () => {
    await dailyGoalsRepo.clearOverride(localDayKey(Date.now()));
    await dailyGoalsRepo.setDefaults({ minutesGoal: 0, lessonsGoal: 0, charsGoal: 0 });
    expect((await todayProgress()).metAll).toBe(false);
    // Restore the fixture defaults for the remaining tests.
    await dailyGoalsRepo.setDefaults({ minutesGoal: 15, lessonsGoal: 1, charsGoal: 100 });
    await dailyGoalsRepo.setOverride(localDayKey(Date.now()), {
      minutesGoal: 0,
      lessonsGoal: 1,
      charsGoal: 0,
    });
  });

  it("the strip reconciles with training_sessions for the last 14 days", async () => {
    const strip = await getConsistency(14);
    expect(strip).toHaveLength(14);
    expect(strip.map((c) => c.date)).toEqual([...strip.map((c) => c.date)].sort());

    const today = strip[strip.length - 1];
    expect(today.date).toBe(localDayKey(Date.now()));
    const actuals = await getTodayActuals();
    expect(today.minutes).toBeCloseTo(actuals.minutes, 6);
    expect(today.chars).toBe(actuals.charsTyped);
    expect(today.lessons).toBe(actuals.lessonsDone);
    // Override active today: 1 enabled goal (lessons), unmet, some activity.
    expect(today.enabledGoals).toBe(1);
    expect(today.status).toBe("missed");

    const yesterday = strip[strip.length - 2];
    expect(yesterday.date).toBe(localDayKey(noon(-1)));
    expect(yesterday.minutes).toBeCloseTo(30, 6);
    expect(yesterday.chars).toBe(400);
    expect(yesterday.lessons).toBe(1);
    // Yesterday follows the defaults (15 min / 1 lesson / 100 chars): met.
    expect(yesterday.status).toBe("met");
    expect(yesterday.metGoals).toBe(3);

    // Untouched days are inactive, never missed.
    expect(strip[0].status).toBe("inactive");
  });

  it("midnight-boundary sessions land on their local days", async () => {
    const midnight = startOfLocalDay(Date.now());
    // 1 minute before midnight vs 1 minute after, same durations.
    for (const [id, startedAt] of [
      ["phase8-edge-before", midnight - 60_000],
      ["phase8-edge-after", midnight + 60_000],
    ] as const) {
      await sessionsRepo.open({
        id,
        kind: "lesson",
        lessonId: "l1-003",
        startedAt,
        endedAt: null,
        durationMs: null,
        charsTyped: 0,
      });
      await sessionsRepo.close(id, startedAt + 30_000, 30_000, 10);
    }
    const strip = await getConsistency(3);
    const byDate = new Map(strip.map((c) => [c.date, c]));
    // Both edge sessions add 10 chars to their own local day.
    expect(byDate.get(localDayKey(midnight - 60_000))!.chars).toBeGreaterThanOrEqual(10);
    expect(byDate.get(localDayKey(midnight + 60_000))!.chars).toBeGreaterThanOrEqual(10);
  });

  it("streak-day numbers follow the activity streak, not goal results", async () => {
    // A completed attempt today joins yesterday into a 2-day activity run.
    // (No progress row: today's LESSONS goal stays unmet on purpose.)
    const tNoon = noon(0);
    await attemptsRepo.insertWithNextNumber({
      lessonId: "l1-002",
      wpm: 40,
      accuracy: 90,
      errorRate: 10,
      errorCount: 5,
      correctChars: 100,
      incorrectChars: 10,
      backspaceCount: 2,
      durationMs: 90_000,
      completed: true,
      startedAt: tNoon,
      finishedAt: tNoon + 90_000,
    });
    const strip = await getConsistency(14);
    const byDate = new Map(strip.map((c) => [c.date, c]));
    // Two consecutive activity days (yesterday + today): streak days 1, 2 —
    // even though today's goals are unmet (goal-miss ≠ streak break).
    expect(byDate.get(localDayKey(noon(-1)))!.streakDay).toBe(1);
    expect(byDate.get(localDayKey(Date.now()))!.streakDay).toBe(2);
    expect(byDate.get(strip[0].date)!.streakDay).toBeNull();
  });
});
