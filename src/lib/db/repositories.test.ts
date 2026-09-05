import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";

import { setDbForTests } from "./client";
import * as schema from "./schema";
import {
  attemptsRepo,
  keyStatsRepo,
  lessonsRepo,
  sessionsRepo,
} from "./repositories";
import { FIXTURE_LESSONS } from "../../content/fixtures";

// The real migration SQL that the Rust binary applies at startup.
const migrationSql = readFileSync(
  new URL("../../../src-tauri/migrations/0000_previous_pestilence.sql", import.meta.url),
  "utf8",
);

/**
 * Repository integration tests — run the REAL generated migration SQL and the
 * REAL drizzle query builders against an in-memory SQLite (node:sqlite),
 * mirroring how `client.ts` maps the drizzle sqlite-proxy methods onto
 * tauri-plugin-sql. This proves the generated statements (RETURNING inserts,
 * composite-key upserts, index DDL) work against a genuine SQLite engine
 * without needing the GUI.
 */

let sqlite: DatabaseSync;

beforeAll(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(migrationSql);

  const proxy = drizzle(async (sql, params, method) => {
    // tauri-plugin-sql serialises params through JSON -> sqlx, which stores
    // JS booleans as SQLite integers; mirror that here for node:sqlite.
    const bound = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
    if (method === "run") {
      sqlite.prepare(sql).run(...bound);
      return { rows: [] };
    }
    const rows = sqlite.prepare(sql).all(...bound) as Record<string, unknown>[];
    // Mirror client.ts: drizzle's proxy mapper indexes rows positionally.
    if (method === "get") {
      return { rows: (rows[0] ? Object.values(rows[0]) : null) as never };
    }
    return { rows: rows.map((row) => Object.values(row)) as never };
  }, { schema });

  setDbForTests(proxy);
});

afterAll(() => {
  setDbForTests(null);
});

describe("migration SQL", () => {
  it("creates all 8 PRD tables plus the 3 planned indexes", () => {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual([
      "custom_lessons",
      "daily_goals",
      "key_statistics",
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
      "idx_lesson_attempts_finished_at",
      "idx_lesson_attempts_lesson_id",
      "idx_lesson_progress_status",
    ]);
  });
});

describe("attemptsRepo", () => {
  it("syncs the fixture lesson, appends attempts and counts them", async () => {
    await lessonsRepo.upsert(FIXTURE_LESSONS[0]);

    const row = await attemptsRepo.insert({
      lessonId: FIXTURE_LESSONS[0].id,
      attemptNumber: await attemptsRepo.nextAttemptNumber(FIXTURE_LESSONS[0].id),
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

    expect(row.id).toBe(1);
    expect(row.completed).toBe(true); // boolean survived integer storage + read mapping
    expect(await attemptsRepo.nextAttemptNumber(FIXTURE_LESSONS[0].id)).toBe(2);

    const second = await attemptsRepo.insert({
      lessonId: FIXTURE_LESSONS[0].id,
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
    expect(second.id).toBe(2);
  });

  it("rejects invalid attempts before touching SQL", async () => {
    await expect(
      attemptsRepo.insert({
        lessonId: FIXTURE_LESSONS[0].id,
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
    expect(await attemptsRepo.nextAttemptNumber(FIXTURE_LESSONS[0].id)).toBe(3);
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
      lessonId: FIXTURE_LESSONS[0].id,
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
      lesson_id: FIXTURE_LESSONS[0].id,
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
