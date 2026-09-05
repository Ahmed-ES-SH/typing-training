import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { CURRICULUM_LESSONS, LEVEL_COUNTS, getLesson, lessonsByLevel } from "../../content";
import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import {
  attemptsRepo,
  lessonsRepo,
  progressRepo,
  statsRepo,
} from "../db/repositories";
import {
  continueFrom,
  getPosition,
  getOverallProgress,
} from "./progressService";

/**
 * §12 aggregate service tests (Phase 5 plan §3.1, §5.2).
 *
 * A fixture DB is seeded with a KNOWN attempt/progress state (deterministic
 * values, no RNG), then EVERY §12 field is asserted twice:
 *  1. against hand-computed constants for the fixture, and
 *  2. against an equivalent raw SQL query on the same DB (reconciliation
 *     sweep — zero drift between service output and SQLite).
 */

let sqlite: DatabaseSync;
const NOW = 1_750_000_000_000;

/** Deterministic fixture attempt metrics. */
function attemptMetrics(attemptIndex: number, dayOffset: number) {
  return {
    wpm: 30 + attemptIndex * 1.5,
    accuracy: 88 + attemptIndex * 0.5,
    errorRate: Math.max(0, 10 - attemptIndex),
    errorCount: attemptIndex,
    correctChars: 100 + attemptIndex,
    incorrectChars: attemptIndex,
    backspaceCount: attemptIndex,
    durationMs: 40_000 + attemptIndex * 1_000,
    completed: true,
    startedAt: NOW - (dayOffset + 1) * 86_400_000,
    finishedAt: NOW - (dayOffset + 1) * 86_400_000 + 45_000,
  };
}

beforeAll(async () => {
  sqlite = connectTestDb();

  // 1. Bundle the curriculum rows (FK targets) — the real Phase 4 seed.
  for (const lesson of CURRICULUM_LESSONS) {
    await lessonsRepo.upsert(lesson);
  }

  // 2. Known progress state: L1 fully completed (26), L2 fully completed (35),
  //    first 14 of L3 completed; lesson 3.15 available.
  const completedIds: string[] = [];
  for (const lesson of lessonsByLevel(1)) completedIds.push(lesson.id);
  for (const lesson of lessonsByLevel(2)) completedIds.push(lesson.id);
  for (const lesson of lessonsByLevel(3).slice(0, 14)) completedIds.push(lesson.id);

  for (const lesson of CURRICULUM_LESSONS) {
    const completed = completedIds.includes(lesson.id);
    const available = lesson.id === lessonsByLevel(3)[14].id;
    await progressRepo.upsert({
      lessonId: lesson.id,
      status: completed ? "completed" : available ? "available" : "locked",
      bestWpm: 0,
      bestAccuracy: 0,
      lowestErrorRate: 100,
      attemptCount: 0,
      unlockedAt: completed || available ? NOW : null,
      completedAt: completed ? NOW - 86_400_000 : null,
      updatedAt: NOW,
    });
  }

  // 3. Attempts: every completed lesson gets 2–6 completed attempts with
  //    deterministic metrics, spread over distinct days. Plus the available
  //    lesson 3.15 gets 10 recent attempts (the §12 recent-10 window).
  let dayOffset = 400; // oldest first
  const attemptedLessons = [
    ...completedIds.map((id) => getLesson(id)!),
    lessonsByLevel(3)[14],
  ];
  for (const lesson of attemptedLessons) {
    const count = lesson.id === lessonsByLevel(3)[14].id ? 10 : 2 + (dayOffset % 5);
    for (let i = 0; i < count; i++) {
      await attemptsRepo.insertWithNextNumber({
        lessonId: lesson.id,
        ...attemptMetrics(i, dayOffset),
      });
      dayOffset = Math.max(0, dayOffset - 1);
    }
  }
});

afterAll(() => {
  setDbForTests(null);
});

/** Raw-SQL oracle for the fixture (reconciliation sweep). */
function scalar(sqlText: string): number {
  const row = sqlite.prepare(sqlText).get() as Record<string, unknown>;
  return Number(Object.values(row)[0]);
}

describe("§12 overall progress (progressService)", () => {
  it("computes totals: completed count, overall %, per-level rows", async () => {
    const progress = await getOverallProgress();

    const expectedCompleted =
      LEVEL_COUNTS[0] + LEVEL_COUNTS[1] + 14; // 26 + 35 + 14
    expect(progress.totalLessons).toBe(260);
    expect(progress.completedLessons).toBe(expectedCompleted);
    expect(progress.overallPct).toBeCloseTo((expectedCompleted / 260) * 100, 6);

    // Reconciliation: same number straight from SQLite.
    const sqlCompleted = scalar(
      "SELECT count(*) FROM lesson_progress WHERE status = 'completed'",
    );
    expect(sqlCompleted).toBe(progress.completedLessons);

    // Per-level breakdown format (§12 example rows).
    expect(progress.perLevel).toHaveLength(7);
    expect(progress.perLevel[0]).toMatchObject({ level: 1, completed: 26, total: 26, pct: 100 });
    expect(progress.perLevel[1]).toMatchObject({ level: 2, completed: 35, total: 35, pct: 100 });
    expect(progress.perLevel[2]).toMatchObject({ level: 3, completed: 14, total: 50 });
    expect(progress.perLevel[3]).toMatchObject({ level: 4, completed: 0, total: 48 });
    expect(progress.perLevel[6]).toMatchObject({ level: 7, completed: 0, total: 22 });
    expect(progress.perLevel[2].pct).toBeCloseTo((14 / 50) * 100, 6);

    // Per-level reconciliation against a GROUP BY join.
    const sqlL3 = scalar(
      "SELECT count(*) FROM lesson_progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.status='completed' AND l.level = 3",
    );
    expect(sqlL3).toBe(progress.perLevel[2].completed);
  });

  it("computes workload: attempts, lifetime + recent-10 means, trend, keys", async () => {
    const progress = await getOverallProgress();

    // Reconciliation first — the service must equal raw SQL exactly.
    const sqlAttempts = scalar(
      "SELECT count(*) FROM lesson_attempts WHERE completed = 1",
    );
    expect(progress.totalAttempts).toBe(sqlAttempts);

    const sqlWpm = scalar(
      "SELECT coalesce(avg(wpm), 0) FROM lesson_attempts WHERE completed = 1",
    );
    expect(progress.lifetimeWpm).toBeCloseTo(sqlWpm, 6);

    const sqlAcc = scalar(
      "SELECT coalesce(avg(accuracy), 0) FROM lesson_attempts WHERE completed = 1",
    );
    expect(progress.lifetimeAccuracy).toBeCloseTo(sqlAcc, 6);

    const sqlKeys = scalar(
      "SELECT coalesce(sum(correct_chars + incorrect_chars), 0) FROM lesson_attempts WHERE completed = 1",
    );
    expect(progress.lifetimeKeys).toBe(sqlKeys);

    const sqlRecent = scalar(
      "SELECT avg(wpm) FROM (SELECT wpm FROM lesson_attempts WHERE completed = 1 ORDER BY finished_at DESC LIMIT 10)",
    );
    expect(progress.recentWpm).toBeCloseTo(sqlRecent, 6);
    expect(progress.wpmTrend).toBeCloseTo(progress.recentWpm - progress.lifetimeWpm, 6);

    // Hand-computed constants for the fixture: the last 10 attempts all sit
    // on lesson 3.15 with metrics attemptMetrics(0..9, 0) in insertion order.
    const recentWpms = Array.from({ length: 10 }, (_, i) => 30 + i * 1.5);
    const expectedRecentMean = recentWpms.reduce((a, b) => a + b, 0) / 10;
    expect(progress.recentWpm).toBeCloseTo(expectedRecentMean, 6);
  });

  it("resolves position: current lesson, last completed, highest unlocked", async () => {
    const position = await getPosition();

    // Current = first available in curriculum order = lesson 3.15.
    const l3 = lessonsByLevel(3);
    expect(position.currentLesson?.id).toBe(l3[14].id);

    // Highest unlocked = furthest non-locked = the current lesson.
    expect(position.highestUnlockedLesson?.id).toBe(l3[14].id);

    // Last completed = newest completed_at; the fixture stamps every
    // completed row with the same NOW-day, so SQLite's MAX resolves it.
    const sqlLast = sqlite
      .prepare(
        "SELECT lesson_id FROM lesson_progress WHERE status='completed' ORDER BY completed_at DESC, lesson_id LIMIT 1",
      )
      .get() as { lesson_id: string };
    expect(position.lastCompletedLesson?.id).toBe(sqlLast.lesson_id);

    // continueFrom() powers the Dashboard resume card.
    const resume = await continueFrom();
    expect(resume?.id).toBe(getLesson(l3[14].id)!.id);
  });

  it("statsRepo overview reconciles with raw SQL", async () => {
    const overview = await statsRepo.overview();
    expect(overview.attempts).toBe(
      scalar("SELECT count(*) FROM lesson_attempts WHERE completed = 1"),
    );
    expect(overview.bestWpm).toBeCloseTo(
      scalar("SELECT max(wpm) FROM lesson_attempts WHERE completed = 1"),
      6,
    );
    expect(overview.keysTyped).toBe(
      scalar(
        "SELECT sum(correct_chars + incorrect_chars) FROM lesson_attempts WHERE completed = 1",
      ),
    );
    const best = await statsRepo.bestAttempt();
    expect(best?.wpm).toBe(overview.bestWpm);
  });
});
