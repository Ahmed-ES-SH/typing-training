import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * Drizzle schema for the 8 PRD §21 tables. Migrations are generated from
 * this file with `pnpm db:generate` into `src-tauri/migrations/` and applied
 * idempotently at app startup by tauri-plugin-sql (see `src-tauri/src/lib.rs`).
 *
 * All timestamps are epoch milliseconds. Booleans are SQLite integers
 * (`mode: "boolean"`). JSON columns are TEXT with `mode: "json"`.
 *
 * Validation contract: data crossing this layer is validated by the Zod
 * schemas in `src/lib/schemas.ts` first (PRD §23).
 */

/* §21 lessons — built-in lesson *metadata* rows are seeded in Phase 4 when
 * the generators exist; user-authored lessons live in `custom_lessons`. */
export const lessons = sqliteTable("lessons", {
  id: text("id").primaryKey(),
  level: integer("level").notNull(),
  orderIndex: integer("order_index").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  content: text("content").notNull(),
  targetKeys: text("target_keys", { mode: "json" })
    .notNull()
    .default(sql`'[]'`),
  tags: text("tags", { mode: "json" })
    .notNull()
    .default(sql`'[]'`),
  source: text("source", { enum: ["builtin", "custom"] })
    .notNull()
    .default("builtin"),
  createdAt: integer("created_at").notNull(),
});

/* §21.1 Lesson -> Lesson Progress. Unlock state transitions are Phase 4. */
export const lessonProgress = sqliteTable(
  "lesson_progress",
  {
    lessonId: text("lesson_id")
      .primaryKey()
      .references(() => lessons.id),
    status: text("status", { enum: ["locked", "available", "completed"] })
      .notNull()
      .default("locked"),
    bestWpm: real("best_wpm").notNull().default(0),
    bestAccuracy: real("best_accuracy").notNull().default(0),
    lowestErrorRate: real("lowest_error_rate").notNull().default(100),
    attemptCount: integer("attempt_count").notNull().default(0),
    unlockedAt: integer("unlocked_at"),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_lesson_progress_status").on(t.status)],
);

/* §10 attempts are append-only: metric columns are never UPDATEd, ever.
 * Phase 6 (migration v3): `kind` splits the unified ledger into lesson /
 * weakness / adaptive attempts; `lesson_id` became nullable because drills
 * are generated (no lesson row backs them). */
export const lessonAttempts = sqliteTable(
  "lesson_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lessonId: text("lesson_id").references(() => lessons.id),
    kind: text("kind", { enum: ["lesson", "weakness", "adaptive"] })
      .notNull()
      .default("lesson"),
    attemptNumber: integer("attempt_number").notNull(),
    wpm: real("wpm").notNull(),
    accuracy: real("accuracy").notNull(),
    errorRate: real("error_rate").notNull(),
    errorCount: integer("error_count").notNull(),
    correctChars: integer("correct_chars").notNull(),
    incorrectChars: integer("incorrect_chars").notNull(),
    backspaceCount: integer("backspace_count").notNull(),
    durationMs: integer("duration_ms").notNull(),
    completed: integer("completed", { mode: "boolean" }).notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at").notNull(),
    /* Phase 4 (migration v2): per-attempt spotlight of the worst characters
     * (expected, misses, avg latency) — the Results screen's key cards. */
    keyReport: text("key_report", { mode: "json" }),
  },
  (t) => [
    index("idx_lesson_attempts_lesson_id").on(t.lessonId),
    index("idx_lesson_attempts_finished_at").on(t.finishedAt),
  ],
);

/* §21.1 Attempts -> Key Statistics. Keyed per character with its shift
 * requirement so `a`/`A` and `(`/`9` are distinct rows (§6.1 symbol focus). */
export const keyStatistics = sqliteTable(
  "key_statistics",
  {
    key: text("key").notNull(),
    shiftRequired: integer("shift_required", { mode: "boolean" }).notNull(),
    totalPresses: integer("total_presses").notNull().default(0),
    correctPresses: integer("correct_presses").notNull().default(0),
    incorrectPresses: integer("incorrect_presses").notNull().default(0),
    avgLatencyMs: real("avg_latency_ms").notNull().default(0),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.shiftRequired] })],
);

/* Phase 6 (migration v3): daily per-key rollups, written at every finish().
 * One row per (local calendar day, character, shift requirement) so rolling
 * 30-day windows (heatmap §14, weakness queue §15, recovery curves) are a
 * single indexed range scan instead of a full attempt replay. */
export const keyStatisticsDaily = sqliteTable(
  "key_statistics_daily",
  {
    date: text("date").notNull(),
    key: text("key").notNull(),
    shiftRequired: integer("shift_required", { mode: "boolean" }).notNull(),
    presses: integer("presses").notNull().default(0),
    correct: integer("correct").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.key, t.shiftRequired] }),
    index("idx_key_statistics_daily_date").on(t.date),
  ],
);

/* Phase 6 (migration v3): planned-bigram difficulty (§13 "difficult key
 * combinations"). Pairs come from the expected content stream; a pair is
 * counted incorrect when either of its chars is mistyped inside it. */
export const bigramStatistics = sqliteTable(
  "bigram_statistics",
  {
    pair: text("pair").primaryKey(),
    total: integer("total").notNull().default(0),
    incorrect: integer("incorrect").notNull().default(0),
    avgLatencyMs: real("avg_latency_ms").notNull().default(0),
  },
  (t) => [index("idx_bigram_statistics_total").on(t.total)],
);

/* One row per app-level training session (opened at start, closed at finish).
 * A force-quit mid-session may leave an unclosed row — tolerated, documented. */
export const trainingSessions = sqliteTable("training_sessions", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["lesson", "weakness", "custom", "adaptive"] })
    .notNull()
    .default("lesson"),
  lessonId: text("lesson_id").references(() => lessons.id),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  durationMs: integer("duration_ms"),
  charsTyped: integer("chars_typed").notNull().default(0),
});

/* §16 custom lessons — complete field set now so Phase 7 is pure UI. */
export const customLessons = sqliteTable("custom_lessons", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  content: text("content").notNull(),
  difficulty: text("difficulty", { enum: ["easy", "medium", "hard"] })
    .notNull()
    .default("medium"),
  targetKeys: text("target_keys", { mode: "json" })
    .notNull()
    .default(sql`'[]'`),
  targetSymbols: text("target_symbols", { mode: "json" })
    .notNull()
    .default(sql`'[]'`),
  wpmTarget: real("wpm_target"),
  accuracyTarget: real("accuracy_target"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/* §18 daily goals — populated/used in Phase 8. */
export const dailyGoals = sqliteTable("daily_goals", {
  date: text("date").primaryKey(),
  minutesGoal: integer("minutes_goal").notNull(),
  lessonsGoal: integer("lessons_goal").notNull(),
  charsGoal: integer("chars_goal").notNull(),
});

/* §20 settings — key/value store used by the Settings screen (Phase 7). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});
