import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { setDbForTests } from "./client";
import { connectTestDb } from "./testing";
import { progressRepo, sessionsRepo } from "./repositories";

/**
 * Hot-query index audit (Phase 8 plan §3.4, PRD §25).
 *
 * Runs `EXPLAIN QUERY PLAN` over the migrated schema at realistic volume
 * (20 lessons × 100 attempts across 60 days + matching sessions) and pins
 * the index-backed shapes of the per-visit hot paths:
 * - attempt pagination / daily series → `idx_lesson_attempts_finished_at`
 * - lesson-scoped history → `idx_lesson_attempts_lesson_id`
 *
 * The full plans print to the test log as evidence (quoted in
 * `docs/perf/PERF_BUDGET.md`). Bounded small-table group-bys
 * (`training_sessions`, `lesson_progress` — one row per session/lesson)
 * assert result correctness instead of plan shape; their scans are linear
 * in tables that stay three orders of magnitude below the attempt ledger.
 * No migration v4 was needed: nothing here showed a missing index on a hot
 * path (see the perf doc for the per-query disposition).
 */

let sqlite: DatabaseSync;

function planOf(sql: string): string[] {
  return (
    sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{
      detail: string;
    }>
  ).map((row) => row.detail);
}

beforeAll(() => {
  sqlite = connectTestDb();

  const lesson = sqlite.prepare(
    "INSERT INTO lessons (id, level, order_index, title, description, content, target_keys, tags, source, created_at) VALUES (?, 1, 0, 't', 'd', 'abc', '[]', '[]', 'builtin', 1)",
  );
  for (let l = 0; l < 20; l++) {
    lesson.run(`l1-${String(l).padStart(3, "0")}`);
  }

  const attempt = sqlite.prepare(
    `INSERT INTO lesson_attempts (lesson_id, kind, attempt_number, wpm, accuracy,
      error_rate, error_count, correct_chars, incorrect_chars, backspace_count,
      duration_ms, completed, started_at, finished_at)
     VALUES (?, 'lesson', ?, 50, 96, 4, 2, 100, 4, 1, 60000, 1, ?, ?)`,
  );
  const session = sqlite.prepare(
    `INSERT INTO training_sessions (id, kind, lesson_id, started_at, ended_at,
      duration_ms, chars_typed) VALUES (?, 'lesson', ?, ?, ?, 60000, 120)`,
  );
  const progress = sqlite.prepare(
    `INSERT INTO lesson_progress (lesson_id, status, best_wpm, best_accuracy,
      lowest_error_rate, attempt_count, unlocked_at, completed_at, updated_at)
     VALUES (?, 'completed', 50, 96, 4, 5, ?, ?, ?)`,
  );
  const now = Date.now();
  for (let i = 0; i < 2000; i++) {
    const lessonId = `l1-${String(i % 20).padStart(3, "0")}`;
    const ts = now - (i % 60) * 86_400_000;
    attempt.run(lessonId, Math.floor(i / 20) + 1, ts, ts + 60_000);
    session.run(`s${i}`, lessonId, ts, ts + 60_000);
    if (i < 20) progress.run(lessonId, ts, ts + 60_000, ts + 60_000);
  }
  sqlite.exec("ANALYZE;");
});

afterAll(() => {
  setDbForTests(null);
});

describe("hot-query index audit", () => {
  it("attempt pagination rides the finished_at index (no sort of the ledger)", () => {
    const plan = planOf(
      "SELECT id FROM lesson_attempts WHERE kind = 'lesson' " +
        "ORDER BY finished_at DESC LIMIT 50 OFFSET 0",
    );
    // eslint-disable-next-line no-console
    console.info(`[perf] attempt-pagination plan: ${plan.join(" // ")}`);
    expect(plan.join("\n")).toContain("USING INDEX idx_lesson_attempts_finished_at");
  });

  it("range-bound daily series seeks the finished_at index", () => {
    const bound = Date.now() - 90 * 86_400_000;
    const plan = planOf(
      `SELECT date(finished_at / 1000, 'unixepoch', 'localtime'), count(*), avg(wpm) ` +
        `FROM lesson_attempts WHERE completed = 1 AND kind = 'lesson' ` +
        `AND finished_at >= ${bound} ` +
        `GROUP BY date(finished_at / 1000, 'unixepoch', 'localtime')`,
    );
    // eslint-disable-next-line no-console
    console.info(`[perf] daily-series plan: ${plan.join(" // ")}`);
    expect(plan.join("\n")).toContain("USING INDEX idx_lesson_attempts_finished_at");
  });

  it("lesson-scoped history seeks the lesson index", () => {
    const plan = planOf(
      "SELECT id FROM lesson_attempts WHERE lesson_id = 'l1-001' " +
        "ORDER BY attempt_number DESC LIMIT 5",
    );
    // eslint-disable-next-line no-console
    console.info(`[perf] lesson-history plan: ${plan.join(" // ")}`);
    expect(plan.join("\n")).toContain("USING INDEX idx_lesson_attempts_lesson_id");
  });

  it("bounded per-day group-bys reconcile exactly (evidence logged)", () => {
    const sessionPlan = planOf(
      `SELECT date(started_at / 1000, 'unixepoch', 'localtime'), ` +
        `coalesce(sum(duration_ms), 0) FROM training_sessions ` +
        `WHERE started_at >= 1 GROUP BY date(started_at / 1000, 'unixepoch', 'localtime')`,
    );
    const progressPlan = planOf(
      `SELECT date(completed_at / 1000, 'unixepoch', 'localtime'), count(*) ` +
        `FROM lesson_progress WHERE status = 'completed' AND completed_at >= 1 ` +
        `GROUP BY date(completed_at / 1000, 'unixepoch', 'localtime')`,
    );
    // eslint-disable-next-line no-console
    console.info(
      `[perf] sessions-by-day plan: ${sessionPlan.join(" // ")}\n` +
        `[perf] progress-by-day plan: ${progressPlan.join(" // ")}`,
    );
    return Promise.all([
      sessionsRepo.totalsByDay(1).then((rows) => {
        // 60 distinct days, 2000 sessions folded into per-day sums.
        expect(rows).toHaveLength(60);
        expect(rows.reduce((n, r) => n + r.durationMs, 0)).toBe(2000 * 60_000);
      }),
      progressRepo.completedByDay(1).then((rows) => {
        expect(rows.reduce((n, r) => n + r.count, 0)).toBe(20);
      }),
    ]);
  });
});
