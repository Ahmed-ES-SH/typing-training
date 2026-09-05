import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "./client";
import {
  keyStatistics,
  lessonAttempts,
  lessonProgress,
  lessons,
  trainingSessions,
} from "./schema";
import {
  AttemptReportRowSchema,
  AttemptRowSchema,
  AttemptSchema,
  KeyReportEntrySchema,
  KeyStatEventSchema,
  KeyStatRowSchema,
  LessonProgressSchema,
  LessonSchema,
  type Attempt,
  type AttemptReportRow,
  type AttemptRow,
  type KeyReportEntry,
  type KeyStatEvent,
  type KeyStatRow,
  type Lesson,
  type LessonProgress,
  type SessionKind,
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
};

/* ---------------------------------------------------------------------------
 * lesson_attempts (§10 — append-only; no UPDATE of metric columns, ever)
 * ------------------------------------------------------------------------- */

/** The §10 metric columns every read path returns (never the key report). */
const ATTEMPT_ROW_COLUMNS = {
  id: lessonAttempts.id,
  lessonId: lessonAttempts.lessonId,
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

  /** Most recent attempts across ALL lessons (rolling hero statistics). */
  async recent(limit = 20): Promise<AttemptRow[]> {
    const db = await getDb();
    const rows = await db
      .select(ATTEMPT_ROW_COLUMNS)
      .from(lessonAttempts)
      .orderBy(desc(lessonAttempts.finishedAt))
      .limit(limit);
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
};

/** Convenience re-export so callers don't import SessionKind separately. */
export type { SessionKind };
