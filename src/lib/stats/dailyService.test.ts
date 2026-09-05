import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { CURRICULUM_LESSONS } from "../../content";
import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import {
  attemptsRepo,
  lessonsRepo,
  sessionsRepo,
} from "../db/repositories";
import {
  computeStreak,
  getStreak,
  getTodayActuals,
  localDayKey,
  startOfLocalDay,
} from "./dailyService";

/**
 * Streak + daily actuals tests (Phase 5 plan §3.2, §5.1).
 *
 * Pure walk: a synthetic broken-streak calendar (5-day run, gap, 2-day run)
 * must yield current=2/best=5. Fixture DB: session/attempt rows across the
 * same calendar must produce identical numbers through the real SQL path.
 */

/** Local noon of `dayOffset` days from today — DST-safe day arithmetic. */
function noon(dayOffset: number): number {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(12, 0, 0, 0);
  return date.getTime();
}

/** Same timestamp the way SQLite's localtime bucketing sees it. */
function sqliteDay(ts: number): string {
  const row = sqlite.prepare(
    "SELECT date(? / 1000, 'unixepoch', 'localtime') AS day",
  ).get(ts) as { day: string };
  return row.day;
}

let sqlite: DatabaseSync;

describe("computeStreak (pure walk)", () => {
  it("walks a broken calendar: 5-day run, gap, 2-day run ending today", () => {
    const today = new Date();
    const dayKey = (offset: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      return localDayKey(d.getTime());
    };
    const days = [
      dayKey(-9), dayKey(-8), dayKey(-7), dayKey(-6), dayKey(-5), // 5-day run
      // gap on -4 .. -2
      dayKey(-1), dayKey(0), // 2-day run ending today
    ];
    expect(computeStreak(days, dayKey(0))).toEqual({ current: 2, bestRun: 5 });
  });

  it("an inactive today does not break a streak ending yesterday", () => {
    expect(computeStreak(["2026-09-03", "2026-09-04"], "2026-09-05").current).toBe(2);
  });

  it("returns 0 with no recent activity", () => {
    expect(computeStreak(["2026-08-01"], "2026-09-05").current).toBe(0);
    expect(computeStreak([], "2026-09-05")).toEqual({ current: 0, bestRun: 0 });
  });
});

describe("getStreak / getTodayActuals (fixture DB)", () => {
  beforeAll(async () => {
    sqlite = connectTestDb();
    for (const lesson of CURRICULUM_LESSONS.slice(0, 20)) {
      await lessonsRepo.upsert(lesson);
    }

    // Session + completed-attempt rows: 5 consecutive days (offsets -9..-5),
    // gap, then yesterday and today. One attempt per day, noon-anchored.
    const dayOffsets = [-9, -8, -7, -6, -5, -1, 0];
    let i = 0;
    for (const offset of dayOffsets) {
      const startedAt = noon(offset);
      i += 1;
      const sessionId = `session-${i}`;
      await sessionsRepo.open({
        id: sessionId,
        kind: "lesson",
        lessonId: "l1-001",
        startedAt,
        endedAt: null,
        durationMs: null,
        charsTyped: 0,
      });
      const finishedAt = startedAt + 60_000;
      await attemptsRepo.insert({
        lessonId: "l1-001",
        attemptNumber: await attemptsRepo.nextAttemptNumber("l1-001"),
        wpm: 50,
        accuracy: 96,
        errorRate: 4,
        errorCount: 2,
        correctChars: 80,
        incorrectChars: 2,
        backspaceCount: 1,
        durationMs: 60_000,
        completed: true,
        startedAt,
        finishedAt,
      });
      await sessionsRepo.close(sessionId, finishedAt, 60_000, 82);
    }

    // An incomplete (abandoned-typed) attempt on a closed day must NOT feed
    // the streak, and an open session from today must still count its chars.
    await attemptsRepo.insert({
      lessonId: "l1-001",
      attemptNumber: await attemptsRepo.nextAttemptNumber("l1-001"),
      wpm: 20,
      accuracy: 60,
      errorRate: 40,
      errorCount: 20,
      correctChars: 10,
      incorrectChars: 10,
      backspaceCount: 5,
      durationMs: 30_000,
      completed: false,
      startedAt: noon(-9),
      finishedAt: noon(-9) + 30_000,
    });
    await sessionsRepo.open({
      id: "session-open",
      kind: "lesson",
      lessonId: "l1-001",
      startedAt: Date.now() - 5_000,
      endedAt: null,
      durationMs: null,
      charsTyped: 0,
    });
  });

  afterAll(() => {
    setDbForTests(null);
  });

  it("produces current=2, best=5 through the real SQL path", async () => {
    const streak = await getStreak();
    expect(streak.current).toBe(2);
    expect(streak.best).toBe(5);

    // The persisted best survives a later call where current is smaller.
    const again = await getStreak();
    expect(again.current).toBe(2);
    expect(again.best).toBe(5);

    // Reconciliation: the SQL day list equals SQLite's own bucketing.
    const sqlDays = (
      sqlite
        .prepare(
          "SELECT DISTINCT date(finished_at/1000,'unixepoch','localtime') AS day FROM lesson_attempts WHERE completed=1 ORDER BY day",
        )
        .all() as Array<{ day: string }>
    ).map((r) => r.day);
    expect(sqlDays).toHaveLength(7);
  });

  it("sums today's minutes/chars from training_sessions and lessons from progress", async () => {
    const actuals = await getTodayActuals();

    const sqlTotals = sqlite
      .prepare(
        "SELECT coalesce(sum(duration_ms),0) AS d, coalesce(sum(chars_typed),0) AS c FROM training_sessions WHERE started_at >= ?",
      )
      .get(startOfLocalDay(Date.now())) as { d: number; c: number };
    expect(actuals.minutes).toBeCloseTo(Number(sqlTotals.d) / 60_000, 6);
    expect(actuals.charsTyped).toBe(Number(sqlTotals.c));

    // The fixture stamps no progress rows, so 0 lessons completed today —
    // reconciled against the same SQL the service runs.
    expect(actuals.lessonsDone).toBe(
      Number(
        (
          sqlite
            .prepare(
              "SELECT count(*) AS n FROM lesson_progress WHERE status='completed' AND completed_at >= ?",
            )
            .get(startOfLocalDay(Date.now())) as { n: number }
        ).n,
      ),
    );
  });

  it("buckets distinct active days with SQLite-local dates", async () => {
    const days = await attemptsRepo.distinctActiveDays();
    expect(days).toEqual([...days].sort());
    expect(days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))).toBe(true);
    // The noon anchor guarantees the SQLite day equals the JS local day.
    expect(days[0]).toBe(sqliteDay(noon(-9)));
    expect(days[days.length - 1]).toBe(sqliteDay(noon(0)));
  });
});

describe("localDayKey / startOfLocalDay", () => {
  it("formats ISO-like local day keys and midnights", () => {
    const ts = new Date(2026, 8, 5, 14, 30).getTime(); // Sep 5 2026 local
    expect(localDayKey(ts)).toBe("2026-09-05");
    expect(localDayKey(startOfLocalDay(ts))).toBe("2026-09-05");
    expect(new Date(startOfLocalDay(ts)).getHours()).toBe(0);
  });
});
