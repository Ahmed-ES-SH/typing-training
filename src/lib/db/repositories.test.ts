import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { setDbForTests } from "./client";
import { connectTestDb } from "./testing";
import { getLesson } from "../../content";
import {
  attemptsRepo,
  keyStatsRepo,
  lessonsRepo,
  sessionsRepo,
} from "./repositories";

/**
 * Repository integration tests — run the REAL generated migration SQL and the
 * REAL drizzle query builders against an in-memory SQLite (node:sqlite),
 * mirroring how `client.ts` maps the drizzle sqlite-proxy methods onto
 * tauri-plugin-sql. This proves the generated statements (RETURNING inserts,
 * composite-key upserts, index DDL) work against a genuine SQLite engine
 * without needing the GUI.
 */

const lesson = getLesson("l1-001")!;

let sqlite: DatabaseSync;

beforeAll(() => {
  sqlite = connectTestDb();
});

afterAll(() => {
  setDbForTests(null);
});

describe("migration SQL", () => {
  it("creates all 8 PRD tables + the 2 Phase 6 rollup tables and indexes", () => {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual([
      "bigram_statistics",
      "custom_lessons",
      "daily_goals",
      "key_statistics",
      "key_statistics_daily",
      "lesson_attempts",
      "lesson_progress",
      "lessons",
      "settings",
      "training_sessions",
    ]);

    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx%' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual([
      "idx_bigram_statistics_total",
      "idx_key_statistics_daily_date",
      "idx_lesson_attempts_finished_at",
      "idx_lesson_attempts_lesson_id",
      "idx_lesson_progress_status",
    ]);
  });
});

describe("attemptsRepo", () => {
  it("inserts with transactional MAX+1 numbering, key report and history", async () => {
    await lessonsRepo.upsert(getLesson("l1-002")!);

    const base = {
      wpm: 48,
      accuracy: 96,
      errorRate: 4,
      errorCount: 4,
      correctChars: 120,
      incorrectChars: 5,
      backspaceCount: 3,
      durationMs: 50_000,
      completed: true,
      startedAt: 1_000,
      finishedAt: 51_000,
    };
    const first = await attemptsRepo.insertWithNextNumber(
      { lessonId: "l1-002", ...base },
      [{ key: "(", shiftRequired: true, totalPresses: 8, incorrectPresses: 3, avgLatencyMs: 180 }],
    );
    const second = await attemptsRepo.insertWithNextNumber({
      lessonId: "l1-002",
      ...base,
    });
    expect(first.attemptNumber).toBe(1);
    expect(second.attemptNumber).toBe(2);

    const fetched = await attemptsRepo.getById(first.id);
    expect(fetched?.lessonId).toBe("l1-002");

    const history = await attemptsRepo.historyFor("l1-002", 5);
    expect(history.map((h) => h.attemptNumber)).toEqual([2, 1]);
  });

  it("syncs a curriculum lesson, appends attempts and counts them", async () => {
    await lessonsRepo.upsert(lesson);

    const row = await attemptsRepo.insert({
      lessonId: lesson.id,
      attemptNumber: await attemptsRepo.nextAttemptNumber(lesson.id),
      wpm: 50.5,
      accuracy: 96.4,
      errorRate: 3.6,
      errorCount: 2,
      correctChars: 80,
      incorrectChars: 2,
      backspaceCount: 4,
      durationMs: 60_000,
      completed: true,
      startedAt: 1_000,
      finishedAt: 61_000,
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.completed).toBe(true); // boolean survived integer storage + read mapping
    expect(await attemptsRepo.nextAttemptNumber(lesson.id)).toBe(2);

    const second = await attemptsRepo.insert({
      lessonId: lesson.id,
      attemptNumber: 2,
      wpm: 55,
      accuracy: 98,
      errorRate: 2,
      errorCount: 1,
      correctChars: 90,
      incorrectChars: 1,
      backspaceCount: 2,
      durationMs: 55_000,
      completed: true,
      startedAt: 2_000,
      finishedAt: 57_000,
    });
    expect(second.id).toBe(row.id + 1);
  });

  it("rejects invalid attempts before touching SQL", async () => {
    await expect(
      attemptsRepo.insert({
        lessonId: lesson.id,
        attemptNumber: 3,
        wpm: -5, // invalid
        accuracy: 98,
        errorRate: 2,
        errorCount: 1,
        correctChars: 90,
        incorrectChars: 1,
        backspaceCount: 2,
        durationMs: 55_000,
        completed: true,
        startedAt: 2_000,
        finishedAt: 57_000,
      }),
    ).rejects.toThrow();
    expect(await attemptsRepo.nextAttemptNumber(lesson.id)).toBe(3);
  });
});

describe("keyStatsRepo", () => {
  it("merges batches in one upsert (counts + weighted latency average)", async () => {
    await keyStatsRepo.recordBatch(
      [
        { key: "a", shiftRequired: false, correct: true, latencyMs: 10 },
        { key: "a", shiftRequired: false, correct: true, latencyMs: 20 },
        { key: "a", shiftRequired: false, correct: false, latencyMs: 30 },
        { key: "A", shiftRequired: true, correct: true, latencyMs: 80 },
      ],
      1_000,
    );
    // Second batch for the same keys — exercises ON CONFLICT DO UPDATE.
    await keyStatsRepo.recordBatch(
      [
        { key: "a", shiftRequired: false, correct: true, latencyMs: 60 },
        { key: "(", shiftRequired: true, correct: false, latencyMs: 120 },
      ],
      2_000,
    );

    const rows = await keyStatsRepo.all();
    const a = rows.find((r) => r.key === "a");
    const aShift = rows.find((r) => r.key === "A");
    const paren = rows.find((r) => r.key === "(");

    // a: total 4, correct 3, avg = (20*3 + 60*1) / 4 = 30
    expect(a).toEqual({
      key: "a",
      shiftRequired: false,
      totalPresses: 4,
      correctPresses: 3,
      incorrectPresses: 1,
      avgLatencyMs: 30,
      lastSeenAt: 2_000,
    });
    expect(aShift?.shiftRequired).toBe(true); // distinct row from 'a'
    expect(aShift?.totalPresses).toBe(1);
    expect(paren?.correctPresses).toBe(0);
    expect(paren?.incorrectPresses).toBe(1);
  });
});

describe("sessionsRepo", () => {
  it("opens a training session and closes it with final metrics", async () => {
    await sessionsRepo.open({
      id: "sess-1",
      kind: "lesson",
      lessonId: lesson.id,
      startedAt: 5_000,
      endedAt: null,
      durationMs: null,
      charsTyped: 0,
    });
    await sessionsRepo.close("sess-1", 65_000, 60_000, 82);

    const rows = sqlite
      .prepare("SELECT * FROM training_sessions WHERE id = 'sess-1'")
      .all() as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      id: "sess-1",
      kind: "lesson",
      lesson_id: lesson.id,
      started_at: 5_000,
      ended_at: 65_000,
      duration_ms: 60_000,
      chars_typed: 82,
    });
  });

  it("enforces the lessons FK on training sessions", async () => {
    await expect(
      sessionsRepo.open({
        id: "sess-orphan",
        kind: "weakness",
        lessonId: "no-such-lesson",
        startedAt: 1,
        endedAt: null,
        durationMs: null,
        charsTyped: 0,
      }),
    ).rejects.toThrow();
  });
});

describe("lesson_progress FK", () => {
  it("rejects progress rows for unknown lessons", async () => {
    const { progressRepo } = await import("./repositories");
    await expect(
      progressRepo.upsert({
        lessonId: "ghost-lesson",
        status: "available",
        bestWpm: 0,
        bestAccuracy: 100,
        lowestErrorRate: 100,
        attemptCount: 0,
        unlockedAt: null,
        completedAt: null,
        updatedAt: 1,
      }),
    ).rejects.toThrow();
  });
});
