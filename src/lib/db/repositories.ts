import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "./client";
import {
  bigramStatistics,
  customLessons,
  dailyGoals as dailyGoalsTable,
  keyStatistics,
  keyStatisticsDaily,
  lessonAttempts,
  lessonProgress,
  lessons,
  settings,
  trainingSessions,
} from "./schema";
import {
  AttemptReportRowSchema,
  AttemptRowSchema,
  AttemptSchema,
  BigramStatRowSchema,
  CustomLessonSchema,
  DrillAttemptRowSchema,
  DrillAttemptSchema,
  KeyReportEntrySchema,
  KeyStatDailyRowSchema,
  KeyStatEventSchema,
  KeyStatRowSchema,
  LessonProgressSchema,
  LessonSchema,
  SettingRowSchema,
  type Attempt,
  type AttemptKind,
  type AttemptReportRow,
  type AttemptRow,
  type BigramStatRow,
  type CustomLesson,
  type DrillAttempt,
  type DrillAttemptRow,
  type KeyReportEntry,
  type KeyStatDailyRow,
  type KeyStatEvent,
  type KeyStatRow,
  type Lesson,
  type LessonProgress,
  type SessionKind,
  type SettingRow,
  type TrainingSession,
} from "../schemas";
import { TrainingSessionSchema } from "../schemas";

/**
 * Repositories over the drizzle bridge. Every input is Zod-validated BEFORE
 * it touches SQL (PRD §23 — validation lives in the frontend layer), and
 * outputs are validated when read back.
 */

/* ---------------------------------------------------------------------------
 * lessons — metadata sync helper (bundled lesson *content* stays in TS/JSON;
 * rows here back the FKs of progress/attempts/sessions until Phase 4 seeds
 * the generated curriculum)
 * ------------------------------------------------------------------------- */

export const lessonsRepo = {
  /** Upserts one lesson's metadata row (Zod-validated). */
  async upsert(lesson: Lesson): Promise<void> {
    const valid = LessonSchema.parse(lesson);
    const db = await getDb();
    const row = {
      id: valid.id,
      level: valid.level,
      orderIndex: valid.orderIndex,
      title: valid.title,
      description: valid.description,
      content: valid.content,
      targetKeys: valid.targetKeys,
      tags: valid.tags,
      source: valid.source,
      createdAt: valid.createdAt,
    };
    await db
      .insert(lessons)
      .values(row)
      .onConflictDoUpdate({ target: lessons.id, set: row });
  },

  /**
   * Multi-row upsert (curriculum seeding: all 260 rows in ONE statement /
   * IPC round trip — a per-row loop is the startup long pole). Full-row
   * overwrite on conflict, same semantics as `upsert`.
   */
  async upsertMany(lessonsIn: Lesson[]): Promise<void> {
    if (lessonsIn.length === 0) return;
    const db = await getDb();
    const rows = lessonsIn.map((lesson) => {
      const valid = LessonSchema.parse(lesson);
      return {
        id: valid.id,
        level: valid.level,
        orderIndex: valid.orderIndex,
        title: valid.title,
        description: valid.description,
        content: valid.content,
        targetKeys: valid.targetKeys,
        tags: valid.tags,
        source: valid.source,
        createdAt: valid.createdAt,
      };
    });
    await db
      .insert(lessons)
      .values(rows)
      .onConflictDoUpdate({
        target: lessons.id,
        set: {
          level: sql`excluded.level`,
          orderIndex: sql`excluded.order_index`,
          title: sql`excluded.title`,
          description: sql`excluded.description`,
          content: sql`excluded.content`,
          targetKeys: sql`excluded.target_keys`,
          tags: sql`excluded.tags`,
          source: sql`excluded.source`,
          createdAt: sql`excluded.created_at`,
        },
      });
  },
};

/* ---------------------------------------------------------------------------
 * lesson_attempts (§10 — append-only; no UPDATE of metric columns, ever)
 * ------------------------------------------------------------------------- */

/** The §10 metric columns every read path returns (never the key report). */
const ATTEMPT_ROW_COLUMNS = {
  id: lessonAttempts.id,
  lessonId: lessonAttempts.lessonId,
  kind: lessonAttempts.kind,
  attemptNumber: lessonAttempts.attemptNumber,
  wpm: lessonAttempts.wpm,
  accuracy: lessonAttempts.accuracy,
  errorRate: lessonAttempts.errorRate,
  errorCount: lessonAttempts.errorCount,
  correctChars: lessonAttempts.correctChars,
  incorrectChars: lessonAttempts.incorrectChars,
  backspaceCount: lessonAttempts.backspaceCount,
  durationMs: lessonAttempts.durationMs,
  completed: lessonAttempts.completed,
  startedAt: lessonAttempts.startedAt,
  finishedAt: lessonAttempts.finishedAt,
} as const;

export const attemptsRepo = {
  /** Next attempt number for a lesson (1-based). */
  async nextAttemptNumber(lessonId: string): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ count: sql<number>`count(*) as count` })
      .from(lessonAttempts)
      .where(eq(lessonAttempts.lessonId, lessonId));
    return Number(rows[0]?.count ?? 0) + 1;
  },

  /** Appends one attempt row (with optional key report). Throws on invalid
   * data, before SQL runs. */
  async insert(attempt: Attempt, keyReport: KeyReportEntry[] = []): Promise<AttemptRow> {
    const valid = AttemptSchema.parse(attempt);
    const report = keyReport.map((entry) => KeyReportEntrySchema.parse(entry));
    const db = await getDb();
    const rows = await db
      .insert(lessonAttempts)
      .values({ ...valid, keyReport: report })
      .returning(ATTEMPT_ROW_COLUMNS);
    return AttemptRowSchema.parse(rows[0]);
  },

  /**
   * Appends one attempt with `attempt_number = MAX(attempt_number) + 1` for
   * the lesson (§10), computed INSIDE the single INSERT statement — the
   * scalar subquery makes the read-modify-write atomic without an explicit
   * transaction across the plugin connection pool.
   */
  async insertWithNextNumber(
    attempt: Omit<Attempt, "attemptNumber">,
    keyReport: KeyReportEntry[] = [],
  ): Promise<AttemptRow> {
    const { attemptNumber: _ignored, ...rest } = AttemptSchema.parse({
      ...attempt,
      attemptNumber: 1, // replaced by the MAX+1 subquery below
    });
    void _ignored;
    const report = keyReport.map((entry) => KeyReportEntrySchema.parse(entry));
    const db = await getDb();
    const rows = await db
      .insert(lessonAttempts)
      .values({
        ...rest,
        attemptNumber: sql`(select coalesce(max(${lessonAttempts.attemptNumber}), 0) + 1 from lesson_attempts where lesson_id = ${attempt.lessonId})`,
        keyReport: report,
      })
      .returning(ATTEMPT_ROW_COLUMNS);
    return AttemptRowSchema.parse(rows[0]);
  },

  /**
   * Appends one attempt row with an explicit ledger `kind` (Phase 7: the
   * custom-lesson practice path records `kind='custom'`; the curriculum path
   * keeps the default `lesson`). Numbering stays MAX+1 inside the INSERT.
   */
  async insertWithKind(
    attempt: Omit<Attempt, "attemptNumber">,
    keyReport: KeyReportEntry[] = [],
    kind: AttemptKind = "lesson",
  ): Promise<AttemptRow> {
    const { attemptNumber: _ignored, ...rest } = AttemptSchema.parse({
      ...attempt,
      attemptNumber: 1,
    });
    void _ignored;
    const report = keyReport.map((entry) => KeyReportEntrySchema.parse(entry));
    const db = await getDb();
    const rows = await db
      .insert(lessonAttempts)
      .values({
        ...rest,
        kind,
        attemptNumber: sql`(select coalesce(max(${lessonAttempts.attemptNumber}), 0) + 1 from lesson_attempts where lesson_id = ${attempt.lessonId} and kind = ${kind})`,
        keyReport: report,
      })
      .returning(ATTEMPT_ROW_COLUMNS);
    return AttemptRowSchema.parse(rows[0]);
  },

  /**
   * Appends one DRILL attempt (Phase 6: `kind` = weakness/adaptive,
   * `lesson_id` NULL — generated sets have no lesson row). `attempt_number`
   * is MAX+1 over the same kind, computed inside the INSERT exactly like the
   * lesson path. Drill attempts never touch `lesson_progress`.
   */
  async insertDrillAttempt(
    attempt: Omit<DrillAttempt, "attemptNumber" | "lessonId">,
    keyReport: KeyReportEntry[] = [],
  ): Promise<DrillAttemptRow> {
    const valid = DrillAttemptSchema.parse({
      ...attempt,
      lessonId: null,
      attemptNumber: 1,
    });
    const report = keyReport.map((entry) => KeyReportEntrySchema.parse(entry));
    const db = await getDb();
    const rows = await db
      .insert(lessonAttempts)
      .values({
        ...valid,
        attemptNumber: sql`(select coalesce(max(${lessonAttempts.attemptNumber}), 0) + 1 from lesson_attempts where lesson_id is null and kind = ${valid.kind})`,
        keyReport: report,
      })
      .returning(ATTEMPT_ROW_COLUMNS);
    return DrillAttemptRowSchema.parse(rows[0]);
  },

  /** Count of drill attempts of a kind (the "DRILL n //" header number). */
  async countByKind(kind: AttemptKind): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(lessonAttempts)
      .where(eq(lessonAttempts.kind, kind));
    return Number(rows[0]?.count ?? 0);
  },

  /**
   * §16 card markers for one custom module: completed-attempt count + PBs
   * read straight from the unified ledger (`kind='custom'`). Custom lessons
   * never touch `lesson_progress`, so this is their only stats source.
   */
  async customStats(
    lessonRef: string,
  ): Promise<{ attempts: number; bestWpm: number; bestAccuracy: number }> {
    const db = await getDb();
    const rows = await db
      .select({
        attempts: sql<number>`count(*)`,
        bestWpm: sql<number>`coalesce(max(${lessonAttempts.wpm}), 0)`,
        bestAccuracy: sql<number>`coalesce(max(${lessonAttempts.accuracy}), 0)`,
      })
      .from(lessonAttempts)
      .where(
        and(
          eq(lessonAttempts.lessonId, lessonRef),
          eq(lessonAttempts.kind, "custom"),
          eq(lessonAttempts.completed, true),
        ),
      );
    const row = rows[0];
    return {
      attempts: Number(row?.attempts ?? 0),
      bestWpm: Number(row?.bestWpm ?? 0),
      bestAccuracy: Number(row?.bestAccuracy ?? 0),
    };
  },

  /** True when the unified ledger holds at least one row (backup sanity). */
  async isEmpty(): Promise<boolean> {
    const db = await getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(lessonAttempts);
    return Number(rows[0]?.count ?? 0) === 0;
  },

  /** Deletes every attempt row (progress-backup replace-all path only —
   * §10 append-only applies to the app's normal operation, never to a
   * user-confirmed restore). */
  async deleteAll(): Promise<void> {
    const db = await getDb();
    await db.delete(lessonAttempts);
  },

  /** Reads one attempt by row id (Results screen deep-link), with the
   * per-attempt key report. */
  async getById(id: number): Promise<AttemptReportRow | null> {
    const db = await getDb();
    const rows = await db
      .select({ ...ATTEMPT_ROW_COLUMNS, keyReport: lessonAttempts.keyReport })
      .from(lessonAttempts)
      .where(eq(lessonAttempts.id, id))
      .limit(1);
    return rows[0] ? AttemptReportRowSchema.parse(rows[0]) : null;
  },

  /** Latest `limit` attempts of a lesson, newest first (attempt ledger). */
  async historyFor(lessonId: string, limit = 5): Promise<AttemptRow[]> {
    const db = await getDb();
    const rows = await db
      .select(ATTEMPT_ROW_COLUMNS)
      .from(lessonAttempts)
      .where(eq(lessonAttempts.lessonId, lessonId))
      .orderBy(desc(lessonAttempts.attemptNumber))
      .limit(limit);
    return rows.map((row) => AttemptRowSchema.parse(row));
  },

  /** Per-attempt key spotlights of the last `limit` attempts, any kind
   * (Phase 6: repeated-error-pattern detection over the unified ledger). */
  async recentKeyReports(limit = 10): Promise<(KeyReportEntry[] | null)[]> {
    const db = await getDb();
    const rows = await db
      .select({ keyReport: lessonAttempts.keyReport })
      .from(lessonAttempts)
      .orderBy(desc(lessonAttempts.finishedAt))
      .limit(limit);
    return rows.map((row) => {
      if (row.keyReport === null || row.keyReport === undefined) return null;
      const parsed = z.array(KeyReportEntrySchema).safeParse(row.keyReport);
      return parsed.success ? parsed.data : null;
    });
  },

  /** Most recent LESSON attempts (rolling hero statistics) — drill rows
   * have no lesson module to resolve and are excluded. */
  async recent(limit = 20): Promise<AttemptRow[]> {
    const db = await getDb();
    const rows = await db
      .select(ATTEMPT_ROW_COLUMNS)
      .from(lessonAttempts)
      .where(LESSON_ONLY)
      .orderBy(desc(lessonAttempts.finishedAt))
      .limit(limit);
    return rows.map((row) => AttemptRowSchema.parse(row));
  },

  /**
   * Distinct local calendar days with at least one completed attempt
   * (the streak walk's input; the list is tiny — one row per active day).
   */
  async distinctActiveDays(): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({ day: DAY_BUCKET })
      // ALL kinds count toward the streak: a finished drill is training too.
      .from(lessonAttempts)
      .where(eq(lessonAttempts.completed, true))
      .groupBy(DAY_BUCKET)
      .orderBy(asc(DAY_BUCKET));
    return rows.map((row) => String(row.day));
  },

  /** Total number of attempt rows (optionally within a finished_at window).
   * Lesson-scoped: drill attempts are counted via their own kind queries. */
  async countAll(fromTs: number | null = null): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(lessonAttempts)
      .where(
        fromTs === null
          ? LESSON_ONLY
          : and(LESSON_ONLY, gte(lessonAttempts.finishedAt, fromTs)),
      );
    return Number(rows[0]?.count ?? 0);
  },

  /**
   * One page of the §24 raw history ledger, newest first. Never a "best
   * only" projection — every attempt row is returned verbatim.
   */
  async page(
    page: number,
    pageSize: number,
    fromTs: number | null = null,
  ): Promise<AttemptRow[]> {
    const db = await getDb();
    const rows = await db
      .select(ATTEMPT_ROW_COLUMNS)
      .from(lessonAttempts)
      .where(
        fromTs === null
          ? LESSON_ONLY
          : and(LESSON_ONLY, gte(lessonAttempts.finishedAt, fromTs)),
      )
      .orderBy(desc(lessonAttempts.finishedAt))
      .limit(pageSize)
      .offset(page * pageSize);
    return rows.map((row) => AttemptRowSchema.parse(row));
  },

  /**
   * The FULL filtered attempt set (CSV export §24) — every row of the
   * filtered window, no aggregation, no limit.
   */
  async allFiltered(fromTs: number | null = null): Promise<AttemptRow[]> {
    const db = await getDb();
    const rows = await db
      .select(ATTEMPT_ROW_COLUMNS)
      .from(lessonAttempts)
      .where(
        fromTs === null
          ? LESSON_ONLY
          : and(LESSON_ONLY, gte(lessonAttempts.finishedAt, fromTs)),
      )
      .orderBy(desc(lessonAttempts.finishedAt));
    return rows.map((row) => AttemptRowSchema.parse(row));
  },
};

/* ---------------------------------------------------------------------------
 * key_statistics (§14 / §21.1)
 * ------------------------------------------------------------------------- */

/** Groups validated keystroke events by (key, shiftRequired). */
function aggregateKeyEvents(
  events: KeyStatEvent[],
): Omit<KeyStatRow, "lastSeenAt">[] {
  const groups = new Map<string, {
    key: string;
    shiftRequired: boolean;
    totalPresses: number;
    correctPresses: number;
    incorrectPresses: number;
    latencySumMs: number;
  }>();
  for (const event of events) {
    const id = `${event.key}\u0000${event.shiftRequired ? "1" : "0"}`;
    const group = groups.get(id) ?? {
      key: event.key,
      shiftRequired: event.shiftRequired,
      totalPresses: 0,
      correctPresses: 0,
      incorrectPresses: 0,
      latencySumMs: 0,
    };
    group.totalPresses += 1;
    if (event.correct) group.correctPresses += 1;
    else group.incorrectPresses += 1;
    group.latencySumMs += event.latencyMs;
    groups.set(id, group);
  }
  return [...groups.values()].map((g) => ({
    key: g.key,
    shiftRequired: g.shiftRequired,
    totalPresses: g.totalPresses,
    correctPresses: g.correctPresses,
    incorrectPresses: g.incorrectPresses,
    avgLatencyMs: g.latencySumMs / g.totalPresses,
  }));
}

export const keyStatsRepo = {
  /**
   * Records all keystrokes of a finished session in ONE upsert statement:
   * a multi-row `INSERT ... ON CONFLICT DO UPDATE` that merges counts and
   * latency averages with the existing rows inside SQLite — no per-keystroke
   * round-trips, no read-modify-write race.
   */
  async recordBatch(events: KeyStatEvent[], now: number): Promise<void> {
    if (events.length === 0) return;
    const validated = events.map((e) => KeyStatEventSchema.parse(e));
    const aggregated = aggregateKeyEvents(validated);
    const values = aggregated.map((row) => ({ ...row, lastSeenAt: now }));

    const db = await getDb();
    await db
      .insert(keyStatistics)
      .values(values)
      .onConflictDoUpdate({
        target: [keyStatistics.key, keyStatistics.shiftRequired],
        set: {
          totalPresses: sql`${keyStatistics.totalPresses} + excluded.total_presses`,
          correctPresses: sql`${keyStatistics.correctPresses} + excluded.correct_presses`,
          incorrectPresses: sql`${keyStatistics.incorrectPresses} + excluded.incorrect_presses`,
          avgLatencyMs: sql`(${keyStatistics.avgLatencyMs} * ${keyStatistics.totalPresses} + excluded.avg_latency_ms * excluded.total_presses) / (${keyStatistics.totalPresses} + excluded.total_presses)`,
          lastSeenAt: sql`max(${keyStatistics.lastSeenAt}, excluded.last_seen_at)`,
        },
      });
  },

  /** Reads all key-stat rows (heatmap / weakness analysis consume later). */
  async all(): Promise<KeyStatRow[]> {
    const db = await getDb();
    const rows = await db.select().from(keyStatistics);
    return rows.map((row) => KeyStatRowSchema.parse(row));
  },

  /**
   * The weak-key SQL (§14/§15 feed): rows with at least `minPresses`
   * samples, worst accuracy first (ties: more misses first). The
   * `weaknessService` maps these to its shared `WeakKey` shape.
   */
  async weakKeys(minPresses: number, limit: number): Promise<KeyStatRow[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(keyStatistics)
      .where(gte(keyStatistics.totalPresses, minPresses))
      .orderBy(
        sql`(${keyStatistics.correctPresses} + 0.0) / ${keyStatistics.totalPresses} asc`,
        desc(keyStatistics.incorrectPresses),
      )
      .limit(limit);
    return rows.map((row) => KeyStatRowSchema.parse(row));
  },

  /**
   * Phase 6 daily rollup: merges one session's key events into TODAY's
   * `key_statistics_daily` rows — one multi-row upsert, same pattern as
   * `recordBatch`. `day` is a local calendar key ("YYYY-MM-DD") so rolling
   * windows are pure SQL range scans (§25: no background jobs).
   */
  async recordDaily(events: KeyStatEvent[], day: string): Promise<void> {
    if (events.length === 0) return;
    const aggregated = aggregateKeyEvents(
      events.map((e) => KeyStatEventSchema.parse(e)),
    );
    const values = aggregated.map((row) => ({
      date: day,
      key: row.key,
      shiftRequired: row.shiftRequired,
      presses: row.totalPresses,
      correct: row.correctPresses,
    }));
    const db = await getDb();
    await db
      .insert(keyStatisticsDaily)
      .values(values)
      .onConflictDoUpdate({
        target: [keyStatisticsDaily.date, keyStatisticsDaily.key, keyStatisticsDaily.shiftRequired],
        set: {
          presses: sql`${keyStatisticsDaily.presses} + excluded.presses`,
          correct: sql`${keyStatisticsDaily.correct} + excluded.correct`,
        },
      });
  },

  /** All daily rows on/after `sinceDay` ("YYYY-MM-DD"), oldest first. */
  async dailySince(sinceDay: string): Promise<KeyStatDailyRow[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(keyStatisticsDaily)
      .where(gte(keyStatisticsDaily.date, sinceDay))
      .orderBy(asc(keyStatisticsDaily.date));
    return rows.map((row) => KeyStatDailyRowSchema.parse(row));
  },
};

/* ---------------------------------------------------------------------------
 * bigram_statistics (Phase 6 — §13 difficult key combinations)
 * ------------------------------------------------------------------------- */

/** Groups validated keystroke events into planned bigram contributions. */
function aggregateBigramEvents(
  events: KeyStatEvent[],
): Map<string, { total: number; incorrect: number; latencySumMs: number }> {
  const groups = new Map<string, { total: number; incorrect: number; latencySumMs: number }>();
  for (let i = 1; i < events.length; i++) {
    const first = events[i - 1];
    const second = events[i];
    // Newlines delimit lines — they are not part of any typed bigram.
    if (first.key === "\n" || second.key === "\n") continue;
    const pair = `${first.key}${second.key}`;
    const group = groups.get(pair) ?? { total: 0, incorrect: 0, latencySumMs: 0 };
    group.total += 1;
    // §2: a pair is incorrect when either of its chars is mistyped inside it.
    if (!first.correct || !second.correct) group.incorrect += 1;
    group.latencySumMs += second.latencyMs;
    groups.set(pair, group);
  }
  return groups;
}

export const bigramStatsRepo = {
  /** Records one session's planned bigrams (expected-char stream) in ONE
   * multi-row upsert: counts merge, latency averages weighted by totals. */
  async recordBatch(events: KeyStatEvent[]): Promise<void> {
    if (events.length < 2) return;
    const aggregated = aggregateBigramEvents(
      events.map((e) => KeyStatEventSchema.parse(e)),
    );
    if (aggregated.size === 0) return;
    const values = [...aggregated.entries()].map(([pair, g]) => ({
      pair,
      total: g.total,
      incorrect: g.incorrect,
      avgLatencyMs: g.total > 0 ? g.latencySumMs / g.total : 0,
    }));
    const db = await getDb();
    await db
      .insert(bigramStatistics)
      .values(values)
      .onConflictDoUpdate({
        target: bigramStatistics.pair,
        set: {
          total: sql`${bigramStatistics.total} + excluded.total`,
          incorrect: sql`${bigramStatistics.incorrect} + excluded.incorrect`,
          avgLatencyMs: sql`(${bigramStatistics.avgLatencyMs} * ${bigramStatistics.total} + excluded.avg_latency_ms * excluded.total) / (${bigramStatistics.total} + excluded.total)`,
        },
      });
  },

  /** Bigrams with at least `minTotal` planned occurrences, most-typed first
   * (error rate is computed by the analyzer from the counts). */
  async all(minTotal = 1): Promise<BigramStatRow[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(bigramStatistics)
      .where(gte(bigramStatistics.total, minTotal))
      .orderBy(desc(bigramStatistics.total));
    return rows.map((row) => BigramStatRowSchema.parse(row));
  },
};

/* ---------------------------------------------------------------------------
 * lesson_progress (§11 — state transitions arrive in Phase 4)
 * ------------------------------------------------------------------------- */

export const progressRepo = {
  async get(lessonId: string): Promise<LessonProgress | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(lessonProgress)
      .where(eq(lessonProgress.lessonId, lessonId))
      .limit(1);
    const row = rows[0];
    return row ? LessonProgressSchema.parse(row) : null;
  },

  /** Upserts a full progress row. */
  async upsert(progress: LessonProgress): Promise<void> {
    const valid = LessonProgressSchema.parse(progress);
    const db = await getDb();
    await db
      .insert(lessonProgress)
      .values(valid)
      .onConflictDoUpdate({ target: lessonProgress.lessonId, set: valid });
  },

  /**
   * Multi-row upsert (first-run seeding: the missing progress rows in ONE
   * statement / IPC round trip). Full-row overwrite on conflict.
   */
  async upsertMany(progressRows: LessonProgress[]): Promise<void> {
    if (progressRows.length === 0) return;
    const db = await getDb();
    const rows = progressRows.map((progress) =>
      LessonProgressSchema.parse(progress),
    );
    await db
      .insert(lessonProgress)
      .values(rows)
      .onConflictDoUpdate({
        target: lessonProgress.lessonId,
        set: {
          status: sql`excluded.status`,
          bestWpm: sql`excluded.best_wpm`,
          bestAccuracy: sql`excluded.best_accuracy`,
          lowestErrorRate: sql`excluded.lowest_error_rate`,
          attemptCount: sql`excluded.attempt_count`,
          unlockedAt: sql`excluded.unlocked_at`,
          completedAt: sql`excluded.completed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  },

  /** Reads every progress row (Lessons screen / seeding bulk path). */
  async all(): Promise<LessonProgress[]> {
    const db = await getDb();
    const rows = await db.select().from(lessonProgress);
    return rows.map((row) => LessonProgressSchema.parse(row));
  },

  /**
   * Merges one finished attempt into the §11 best-statistics, bumping the
   * attempt count — bests only ever move forward (max wpm/accuracy, min
   * error rate), so replays can never degrade a record.
   */
  async mergeAttemptStats(
    progress: LessonProgress,
    now: number,
  ): Promise<void> {
    const valid = LessonProgressSchema.parse(progress);
    const db = await getDb();
    await db
      .insert(lessonProgress)
      .values(valid)
      .onConflictDoUpdate({
        target: lessonProgress.lessonId,
        set: {
          bestWpm: sql`max(${lessonProgress.bestWpm}, excluded.best_wpm)`,
          bestAccuracy: sql`max(${lessonProgress.bestAccuracy}, excluded.best_accuracy)`,
          lowestErrorRate: sql`min(${lessonProgress.lowestErrorRate}, excluded.lowest_error_rate)`,
          attemptCount: sql`${lessonProgress.attemptCount} + 1`,
          updatedAt: now,
        },
      });
  },

  /**
   * Marks a lesson `available` ONLY while it is currently `locked` — the
   * conditional UPDATE is the re-lock prevention guarantee (§8): completed
   * or already-available rows are silently untouched.
   */
  async unlockIfLocked(lessonId: string, now: number): Promise<void> {
    const db = await getDb();
    await db
      .update(lessonProgress)
      .set({ status: "available", unlockedAt: now, updatedAt: now })
      .where(
        and(
          eq(lessonProgress.lessonId, lessonId),
          eq(lessonProgress.status, "locked"),
        ),
      );
  },

  /* ------------------------- §12 aggregate reads ------------------------- */

  /** Count of completed lessons (GROUP BY is wasted on a scalar — COUNT). */
  async countByStatus(status: "locked" | "available" | "completed"): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(lessonProgress)
      .where(eq(lessonProgress.status, status));
    return Number(rows[0]?.count ?? 0);
  },

  /** Completed lesson count per curriculum level (SQL GROUP BY, §12). */
  async completedByLevel(): Promise<Map<number, number>> {
    const db = await getDb();
    const rows = await db
      .select({
        level: lessons.level,
        completed: sql<number>`count(*)`,
      })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .where(eq(lessonProgress.status, "completed"))
      .groupBy(lessons.level);
    return new Map(rows.map((row) => [Number(row.level), Number(row.completed)]));
  },

  /** Lesson ids with a given status (curriculum order applied by callers). */
  async lessonIdsByStatus(
    status: "locked" | "available" | "completed",
  ): Promise<string[]> {
    const db = await getDb();
    const rows = await db
      .select({ lessonId: lessonProgress.lessonId })
      .from(lessonProgress)
      .where(eq(lessonProgress.status, status));
    return rows.map((row) => row.lessonId);
  },

  /** Most recently completed lesson row (max completed_at), §12. */
  async lastCompleted(): Promise<LessonProgress | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(lessonProgress)
      .where(eq(lessonProgress.status, "completed"))
      .orderBy(desc(lessonProgress.completedAt))
      .limit(1);
    return rows[0] ? LessonProgressSchema.parse(rows[0]) : null;
  },

  /** Lessons completed since the given timestamp (daily goal §18 actual). */
  async countCompletedSince(fromTs: number): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.status, "completed"),
          gte(lessonProgress.completedAt, fromTs),
        ),
      );
    return Number(rows[0]?.count ?? 0);
  },

  /**
   * Per-day completed-lesson counts since `fromTs` (Phase 8 consistency
   * strip), keyed by LOCAL calendar day. The table holds one row per
   * lesson (~260 rows), so the status-index scan stays trivial.
   */
  async completedByDay(fromTs: number): Promise<Array<{ day: string; count: number }>> {
    const db = await getDb();
    const bucket = sql<string>`date(${lessonProgress.completedAt} / 1000, 'unixepoch', 'localtime')`;
    const rows = await db
      .select({ day: bucket, count: sql<number>`count(*)` })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.status, "completed"),
          gte(lessonProgress.completedAt, fromTs),
        ),
      )
      .groupBy(bucket)
      .orderBy(asc(bucket));
    return rows.map((row) => ({ day: String(row.day), count: Number(row.count) }));
  },
};

/* ---------------------------------------------------------------------------
 * training_sessions (§21 — opened at session start, closed at finish)
 * ------------------------------------------------------------------------- */

export const sessionsRepo = {
  async open(
    session: TrainingSession,
  ): Promise<void> {
    const valid = TrainingSessionSchema.parse(session);
    const db = await getDb();
    await db.insert(trainingSessions).values(valid);
  },

  /** Closes a session row (the only mutable table besides progress/settings). */
  async close(
    id: string,
    endedAt: number,
    durationMs: number,
    charsTyped: number,
  ): Promise<void> {
    const db = await getDb();
    await db
      .update(trainingSessions)
      .set({ endedAt, durationMs, charsTyped })
      .where(eq(trainingSessions.id, id));
  },

  /**
   * Aggregated training time + characters since `fromTs` (§18 daily
   * actuals). SUM ignores NULL durations (still-open rows) — abandoned
   * sessions ARE counted: their typing happened.
   */
  async totalsSince(fromTs: number): Promise<{ durationMs: number; chars: number }> {
    const db = await getDb();
    const rows = await db
      .select({
        durationMs: sql<number>`coalesce(sum(${trainingSessions.durationMs}), 0)`,
        chars: sql<number>`coalesce(sum(${trainingSessions.charsTyped}), 0)`,
      })
      .from(trainingSessions)
      .where(gte(trainingSessions.startedAt, fromTs));
    return {
      durationMs: Number(rows[0]?.durationMs ?? 0),
      chars: Number(rows[0]?.chars ?? 0),
    };
  },

  /**
   * Per-day training totals since `fromTs` (Phase 8 consistency strip),
   * keyed by LOCAL calendar day of `started_at` — the same bucketing the
   * streak query uses, so the strip reconciles with `totalsSince` exactly.
   * One row per session keeps the scan trivial; the window bound keeps it
   * constant-size regardless of lifetime history.
   */
  async totalsByDay(fromTs: number): Promise<Array<{ day: string; durationMs: number; chars: number }>> {
    const db = await getDb();
    const bucket = sql<string>`date(${trainingSessions.startedAt} / 1000, 'unixepoch', 'localtime')`;
    const rows = await db
      .select({
        day: bucket,
        durationMs: sql<number>`coalesce(sum(${trainingSessions.durationMs}), 0)`,
        chars: sql<number>`coalesce(sum(${trainingSessions.charsTyped}), 0)`,
      })
      .from(trainingSessions)
      .where(gte(trainingSessions.startedAt, fromTs))
      .groupBy(bucket)
      .orderBy(asc(bucket));
    return rows.map((row) => ({
      day: String(row.day),
      durationMs: Number(row.durationMs ?? 0),
      chars: Number(row.chars ?? 0),
    }));
  },
};

/* ---------------------------------------------------------------------------
 * custom_lessons (§16 — Phase 7: full CRUD + draft lifecycle)
 *
 * Custom modules live OUTSIDE the §7/§8 unlock chain: practicing one
 * records `kind='custom'` attempts and never writes `lesson_progress`.
 * Deleting a module keeps its attempt rows in the unified ledger (§10
 * append-only history is never rewritten); the `lessons` mirror row that
 * backs the attempt FKs is retained for the same reason — it is invisible
 * to the curriculum (which reads the bundled generator output).
 * ------------------------------------------------------------------------- */

export const customLessonsRepo = {
  /** All custom modules, newest activity first. */
  async all(): Promise<CustomLesson[]> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(customLessons)
      .orderBy(desc(customLessons.updatedAt));
    return rows.map((row) => CustomLessonSchema.parse(row));
  },

  async get(id: string): Promise<CustomLesson | null> {
    const db = await getDb();
    const rows = await db
      .select()
      .from(customLessons)
      .where(eq(customLessons.id, id))
      .limit(1);
    return rows[0] ? CustomLessonSchema.parse(rows[0]) : null;
  },

  /** Inserts a fully-formed module (Zod-validated before SQL). */
  async insert(lesson: CustomLesson): Promise<void> {
    const valid = CustomLessonSchema.parse(lesson);
    const db = await getDb();
    await db.insert(customLessons).values(valid);
  },

  /** Applies a partial patch, bumping `updated_at` (draft toggle, edits). */
  async update(
    id: string,
    patch: Partial<Omit<CustomLesson, "id" | "createdAt">>,
    updatedAt = Date.now(),
  ): Promise<CustomLesson | null> {
    const current = await this.get(id);
    if (current === null) return null;
    const valid = CustomLessonSchema.parse({ ...current, ...patch, updatedAt });
    const db = await getDb();
    await db
      .update(customLessons)
      .set(valid)
      .where(eq(customLessons.id, id));
    return valid;
  },

  /** Removes the module. Attempt rows are RETAINED in the ledger. */
  async remove(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(customLessons).where(eq(customLessons.id, id));
  },

  async count(): Promise<number> {
    const db = await getDb();
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(customLessons);
    return Number(rows[0]?.count ?? 0);
  },

  /** Deletes every custom module (progress-backup replace-all path). */
  async deleteAll(): Promise<void> {
    const db = await getDb();
    await db.delete(customLessons);
  },
};

/* ---------------------------------------------------------------------------
 * settings (§20 — key/value; Phase 5 stores the persisted best streak)
 * ------------------------------------------------------------------------- */

export const settingsRepo = {
  async get(key: string): Promise<unknown | null> {
    const db = await getDb();
    const rows = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  },

  async set(key: string, value: unknown, now = Date.now()): Promise<void> {
    const db = await getDb();
    await db
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
  },

  /** Every settings row (backup export + backup restore replace-all). */
  async all(): Promise<SettingRow[]> {
    const db = await getDb();
    const rows = await db.select().from(settings);
    return rows.map((row) => SettingRowSchema.parse(row));
  },

  /** Overwrites the whole settings table (restore path only). */
  async replaceAll(rows: SettingRow[]): Promise<void> {
    const db = await getDb();
    await db.delete(settings);
    if (rows.length > 0) {
      await db.insert(settings).values(rows.map((row) => SettingRowSchema.parse(row)));
    }
  },
};

/* ---------------------------------------------------------------------------
 * statsRepo — §24/§25 chart aggregates. Every series is computed INSIDE
 * SQLite (GROUP BY / AVG / MAX) so charts never load the whole attempts
 * table into JS. All metric aggregates are scoped to COMPLETED attempts
 * (§2 design decision: lifetime figures mean "completed attempts").
 * ------------------------------------------------------------------------- */

/** Local-time day bucket of a finished_at timestamp (SQLite date modifier). */
const DAY_BUCKET = sql<string>`date(${lessonAttempts.finishedAt} / 1000, 'unixepoch', 'localtime')`;

/** The §8 gate as a SQL expression (accuracy >= 92 AND wpm > 45) — must
 * mirror `ACCURACY_GATE`/`WPM_GATE` in `lib/curriculum/rules.ts`. */
const GATE_PASSED = sql<number>`case when ${lessonAttempts.accuracy} >= 92 and ${lessonAttempts.wpm} > 45 then 1 else 0 end`;

/** Lesson charts/ledgers are scoped to lesson attempts — drill attempts
 * (Phase 6, lesson_id NULL) never pollute lesson aggregates. */
const LESSON_ONLY = eq(lessonAttempts.kind, "lesson");

export type StatsRange = "30d" | "90d" | "all";

/** Start-of-window epoch ms for a range (null = unbounded). */
export function rangeStart(range: StatsRange, now = Date.now()): number | null {
  switch (range) {
    case "30d":
      return now - 30 * 86_400_000;
    case "90d":
      return now - 90 * 86_400_000;
    case "all":
      return null;
  }
}

export interface AttemptOverview {
  attempts: number;
  avgWpm: number;
  avgAccuracy: number;
  bestWpm: number;
  bestWpmLessonId: string | null;
  totalDurationMs: number;
  /** correct + incorrect characters across completed attempts. */
  keysTyped: number;
}

export interface DayBucket {
  /** Local-time calendar date, "YYYY-MM-DD". */
  day: string;
  attempts: number;
  avgWpm: number;
  bestWpm: number;
  avgAccuracy: number;
}

export interface AttemptPoint {
  id: number;
  finishedAt: number;
  wpm: number;
  accuracy: number;
  lessonId: string;
  attemptNumber: number;
}

export interface LevelMean {
  level: number;
  attempts: number;
  avgWpm: number;
}

export interface ImprovementBucket {
  /** "1" | "2" | "3" | "4" | "5+" */
  bucket: string;
  attempts: number;
  avgWpm: number;
}

export const statsRepo = {
  /** Lifetime aggregate over completed attempts (one GROUP-less scan). */
  async overview(fromTs: number | null = null): Promise<AttemptOverview> {
    const db = await getDb();
    const rows = await db
      .select({
        attempts: sql<number>`count(*)`,
        avgWpm: sql<number>`coalesce(avg(${lessonAttempts.wpm}), 0)`,
        avgAccuracy: sql<number>`coalesce(avg(${lessonAttempts.accuracy}), 0)`,
        bestWpm: sql<number>`coalesce(max(${lessonAttempts.wpm}), 0)`,
        totalDurationMs: sql<number>`coalesce(sum(${lessonAttempts.durationMs}), 0)`,
        keysTyped: sql<number>`coalesce(sum(${lessonAttempts.correctChars} + ${lessonAttempts.incorrectChars}), 0)`,
      })
      .from(lessonAttempts)
      .where(
        fromTs === null
          ? and(eq(lessonAttempts.completed, true), LESSON_ONLY)
          : and(eq(lessonAttempts.completed, true), LESSON_ONLY, gte(lessonAttempts.finishedAt, fromTs)),
      );
    const row = rows[0];
    const best = await this.bestAttempt(fromTs);
    return {
      attempts: Number(row?.attempts ?? 0),
      avgWpm: Number(row?.avgWpm ?? 0),
      avgAccuracy: Number(row?.avgAccuracy ?? 0),
      bestWpm: Number(row?.bestWpm ?? 0),
      bestWpmLessonId: best?.lessonId ?? null,
      totalDurationMs: Number(row?.totalDurationMs ?? 0),
      keysTyped: Number(row?.keysTyped ?? 0),
    };
  },

  /** The completed attempt with the highest WPM (statistics hero chip). */
  async bestAttempt(
    fromTs: number | null = null,
  ): Promise<{ wpm: number; lessonId: string; finishedAt: number } | null> {
    const db = await getDb();
    const rows = await db
      .select({
        wpm: lessonAttempts.wpm,
        lessonId: lessonAttempts.lessonId,
        finishedAt: lessonAttempts.finishedAt,
      })
      .from(lessonAttempts)
      .where(
        fromTs === null
          ? and(eq(lessonAttempts.completed, true), LESSON_ONLY)
          : and(eq(lessonAttempts.completed, true), LESSON_ONLY, gte(lessonAttempts.finishedAt, fromTs)),
      )
      .orderBy(desc(lessonAttempts.wpm))
      .limit(1);
    const row = rows[0];
    // lesson_id is non-null for lesson rows (guaranteed by LESSON_ONLY).
    return row
      ? { wpm: Number(row.wpm), lessonId: row.lessonId as string, finishedAt: row.finishedAt }
      : null;
  },

  /** Mean of the last `limit` completed attempts (§2 "recent" figure). */
  async recentMean(
    limit = 10,
  ): Promise<{ wpm: number; accuracy: number; count: number } | null> {
    const db = await getDb();
    const rows = await db
      .select({
        wpm: sql<number>`avg(wpm)`,
        accuracy: sql<number>`avg(accuracy)`,
        count: sql<number>`count(*)`,
      })
      .from(
        db
          .select({ wpm: lessonAttempts.wpm, accuracy: lessonAttempts.accuracy })
          .from(lessonAttempts)
          .where(and(eq(lessonAttempts.completed, true), LESSON_ONLY))
          .orderBy(desc(lessonAttempts.finishedAt))
          .limit(limit)
          .as("recent"),
      );
    const row = rows[0];
    if (!row || Number(row.count) === 0) return null;
    return { wpm: Number(row.wpm), accuracy: Number(row.accuracy), count: Number(row.count) };
  },

  /** Per-day buckets (local time): mean/best WPM + mean accuracy. */
  async dailySeries(fromTs: number | null = null): Promise<DayBucket[]> {
    const db = await getDb();
    const rows = await db
      .select({
        day: DAY_BUCKET,
        attempts: sql<number>`count(*)`,
        avgWpm: sql<number>`avg(${lessonAttempts.wpm})`,
        bestWpm: sql<number>`max(${lessonAttempts.wpm})`,
        avgAccuracy: sql<number>`avg(${lessonAttempts.accuracy})`,
      })
      .from(lessonAttempts)
      .where(
        fromTs === null
          ? and(eq(lessonAttempts.completed, true), LESSON_ONLY)
          : and(eq(lessonAttempts.completed, true), LESSON_ONLY, gte(lessonAttempts.finishedAt, fromTs)),
      )
      .groupBy(DAY_BUCKET)
      .orderBy(asc(DAY_BUCKET));
    return rows.map((row) => ({
      day: String(row.day),
      attempts: Number(row.attempts),
      avgWpm: Number(row.avgWpm),
      bestWpm: Number(row.bestWpm),
      avgAccuracy: Number(row.avgAccuracy),
    }));
  },

  /** Per-attempt points (the design's "session avg" scatter/line). */
  async attemptPoints(fromTs: number | null = null): Promise<AttemptPoint[]> {
    const db = await getDb();
    const rows = await db
      .select({
        id: lessonAttempts.id,
        finishedAt: lessonAttempts.finishedAt,
        wpm: lessonAttempts.wpm,
        accuracy: lessonAttempts.accuracy,
        lessonId: lessonAttempts.lessonId,
        attemptNumber: lessonAttempts.attemptNumber,
      })
      .from(lessonAttempts)
      .where(
        fromTs === null
          ? and(eq(lessonAttempts.completed, true), LESSON_ONLY)
          : and(eq(lessonAttempts.completed, true), LESSON_ONLY, gte(lessonAttempts.finishedAt, fromTs)),
      )
      .orderBy(asc(lessonAttempts.finishedAt));
    return rows.map((row) => ({
      id: Number(row.id),
      finishedAt: Number(row.finishedAt),
      wpm: Number(row.wpm),
      accuracy: Number(row.accuracy),
      // Non-null for lesson rows (guaranteed by LESSON_ONLY).
      lessonId: row.lessonId as string,
      attemptNumber: Number(row.attemptNumber),
    }));
  },

  /** Mean WPM per curriculum level (PER LEVEL bar chart). */
  async perLevelMeans(fromTs: number | null = null): Promise<LevelMean[]> {
    const db = await getDb();
    const rows = await db
      .select({
        level: lessons.level,
        attempts: sql<number>`count(*)`,
        avgWpm: sql<number>`avg(${lessonAttempts.wpm})`,
      })
      .from(lessonAttempts)
      .innerJoin(lessons, eq(lessons.id, lessonAttempts.lessonId))
      .where(
        fromTs === null
          ? and(eq(lessonAttempts.completed, true), LESSON_ONLY)
          : and(eq(lessonAttempts.completed, true), LESSON_ONLY, gte(lessonAttempts.finishedAt, fromTs)),
      )
      .groupBy(lessons.level)
      .orderBy(asc(lessons.level));
    return rows.map((row) => ({
      level: Number(row.level),
      attempts: Number(row.attempts),
      avgWpm: Number(row.avgWpm),
    }));
  },

  /**
   * "Improvement across attempts": mean WPM by attempt-number bucket over
   * lessons with at least 3 completed attempts (thin one-off lessons would
   * drown the trend). Buckets: attempts 1, 2, 3, 4, 5+.
   */
  async improvementBuckets(): Promise<ImprovementBucket[]> {
    const db = await getDb();
    const multiLesson = db
      .select({ lessonId: lessonAttempts.lessonId })
      .from(lessonAttempts)
      .where(and(eq(lessonAttempts.completed, true), LESSON_ONLY))
      .groupBy(lessonAttempts.lessonId)
      .having(sql`count(*) >= 3`)
      .as("multi_lesson");
    // The GROUP BY must inline the CASE expression itself: SQLite does not
    // resolve SELECT aliases inside GROUP BY for this query shape.
    const bucketExpr = sql<number>`case when ${lessonAttempts.attemptNumber} <= 4 then ${lessonAttempts.attemptNumber} else 5 end`;
    const rows = await db
      .select({
        bucketOrder: bucketExpr,
        attempts: sql<number>`count(*)`,
        avgWpm: sql<number>`avg(${lessonAttempts.wpm})`,
      })
      .from(lessonAttempts)
      .innerJoin(multiLesson, eq(multiLesson.lessonId, lessonAttempts.lessonId))
      .where(and(eq(lessonAttempts.completed, true), LESSON_ONLY))
      .groupBy(bucketExpr)
      .orderBy(bucketExpr);
    return rows.map((row) => ({
      bucket: Number(row.bucketOrder) === 5 ? "5+" : String(Number(row.bucketOrder)),
      attempts: Number(row.attempts),
      avgWpm: Number(row.avgWpm),
    }));
  },

  /** First-try pass rate (§26 read-out): of completed attempts numbered 1,
   * the fraction that clears the §8 gate. */
  async firstTryPassRate(): Promise<{ firstTries: number; passed: number }> {
    const db = await getDb();
    const rows = await db
      .select({
        firstTries: sql<number>`count(*)`,
        passed: sql<number>`coalesce(sum(${GATE_PASSED}), 0)`,
      })
      .from(lessonAttempts)
      .where(
        and(eq(lessonAttempts.completed, true), LESSON_ONLY, eq(lessonAttempts.attemptNumber, 1)),
      );
    return {
      firstTries: Number(rows[0]?.firstTries ?? 0),
      passed: Number(rows[0]?.passed ?? 0),
    };
  },

  /** Database file size in bytes (footer read-out; null when unavailable). */
  async dbSizeBytes(): Promise<number | null> {
    try {
      const db = await getDb();
      const rows = await db
        .select({ size: sql<number>`page_count * page_size` })
        .from(sql`pragma_page_count(), pragma_page_size()`);
      return rows[0] ? Number(rows[0].size) : null;
    } catch {
      return null;
    }
  },
};

/** Convenience re-export so callers don't import SessionKind separately. */
export type { SessionKind };

/* ---------------------------------------------------------------------------
 * backupRepo (§17 progress backups — Phase 7)
 *
 * Verbatim full-table reads/writes for the portable backup envelope. Only the
 * user-confirmed restore path ever deletes here; the app's normal operation
 * stays append-only (§10).
 * ------------------------------------------------------------------------- */

/** A raw attempt row exactly as stored (incl. `kind` + nullable lesson). */
export interface RawAttemptRow {
  id: number;
  lessonId: string | null;
  kind: AttemptKind;
  attemptNumber: number;
  wpm: number;
  accuracy: number;
  errorRate: number;
  errorCount: number;
  correctChars: number;
  incorrectChars: number;
  backspaceCount: number;
  durationMs: number;
  completed: boolean;
  startedAt: number;
  finishedAt: number;
  keyReport: KeyReportEntry[] | null;
}

export const backupRepo = {  async lessonsAll(): Promise<Lesson[]> {
    const db = await getDb();
    const rows = await db.select().from(lessons);
    return rows.map((row) => LessonSchema.parse(row));
  },

  async attemptsAll(): Promise<RawAttemptRow[]> {
    const db = await getDb();
    const rows = await db.select().from(lessonAttempts);
    return rows.map((row) => ({
      id: Number(row.id),
      lessonId: (row.lessonId as string | null) ?? null,
      kind: row.kind as AttemptKind,
      attemptNumber: Number(row.attemptNumber),
      wpm: Number(row.wpm),
      accuracy: Number(row.accuracy),
      errorRate: Number(row.errorRate),
      errorCount: Number(row.errorCount),
      correctChars: Number(row.correctChars),
      incorrectChars: Number(row.incorrectChars),
      backspaceCount: Number(row.backspaceCount),
      durationMs: Number(row.durationMs),
      completed: Boolean(row.completed),
      startedAt: Number(row.startedAt),
      finishedAt: Number(row.finishedAt),
      keyReport:
        row.keyReport === null || row.keyReport === undefined
          ? null
          : (z.array(KeyReportEntrySchema).parse(row.keyReport) as KeyReportEntry[]),
    }));
  },

  async sessionsAll(): Promise<TrainingSession[]> {
    const db = await getDb();
    const rows = await db.select().from(trainingSessions);
    return rows.map((row) => TrainingSessionSchema.parse(row));
  },

  async dailyGoalsAll(): Promise<unknown[]> {
    const db = await getDb();
    return db.select().from(dailyGoalsTable);
  },

  /**
   * Deletes every training-data row in FK-safe order (settings + custom
   * lessons included — a progress backup restores the WHOLE local state).
   * Runs inside the caller's transaction (the §17 restore path) — the
   * `withTransaction` handle types as the plain drizzle db.
   */
  async deleteAllForRestore(
    tx: Awaited<ReturnType<typeof getDb>>,
  ): Promise<void> {
    await tx.delete(lessonAttempts);
    await tx.delete(lessonProgress);
    await tx.delete(trainingSessions);
    await tx.delete(keyStatistics);
    await tx.delete(keyStatisticsDaily);
    await tx.delete(bigramStatistics);
    await tx.delete(dailyGoalsTable);
    await tx.delete(customLessons);
    await tx.delete(lessons);
  },
};
