import { eq, sql } from "drizzle-orm";

import { getDb } from "./client";
import {
  keyStatistics,
  lessonAttempts,
  lessonProgress,
  lessons,
  trainingSessions,
} from "./schema";
import {
  AttemptRowSchema,
  AttemptSchema,
  KeyStatEventSchema,
  KeyStatRowSchema,
  LessonProgressSchema,
  LessonSchema,
  type Attempt,
  type AttemptRow,
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

  /** Appends one attempt row. Throws on invalid data, before SQL runs. */
  async insert(attempt: Attempt): Promise<AttemptRow> {
    const valid = AttemptSchema.parse(attempt);
    const db = await getDb();
    const rows = await db
      .insert(lessonAttempts)
      .values(valid)
      .returning({
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
      });
    return AttemptRowSchema.parse(rows[0]);
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
