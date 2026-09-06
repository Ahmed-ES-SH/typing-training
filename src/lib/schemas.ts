import { z } from "zod";

/**
 * Zod domain schemas (PRD §23) — the single source of truth shared by the
 * typing engine, the repositories and (in later phases) import/export
 * validation. Invalid data throws here, *before* any SQL is touched, because
 * the app has no backend: the frontend layer owns validation.
 *
 * All timestamps are epoch milliseconds (integer). The generated Drizzle
 * schema (`src/lib/db/schema.ts`) mirrors these shapes 1:1.
 */

/* ---------------------------------------------------------------------------
 * Lessons
 * ------------------------------------------------------------------------- */

export const LessonSourceSchema = z.enum(["builtin", "custom"]);
export type LessonSource = z.infer<typeof LessonSourceSchema>;

export const LessonSchema = z.object({
  /** e.g. "l1-003" for built-ins, "custom-<uuid>" for user lessons. */
  id: z.string().min(1),
  /** Curriculum level 1-7 (PRD §6); 1-7 keeps room for future levels. */
  level: z.number().int().min(1).max(7),
  orderIndex: z.number().int().min(0),
  title: z.string().min(1),
  description: z.string().default(""),
  /** Real code content; `\n` are literal newlines, tabs are not allowed. */
  content: z
    .string()
    .min(1)
    .refine((c) => !c.includes("\t"), { message: "tabs are not supported" }),
  /** Characters this lesson trains (e.g. ["-", ">", "."]). */
  targetKeys: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string()).default([]),
  source: LessonSourceSchema.default("builtin"),
  createdAt: z.number().int().nonnegative(),
});
export type Lesson = z.infer<typeof LessonSchema>;

/* ---------------------------------------------------------------------------
 * Lesson progress (PRD §11 — per-lesson statistics; state transitions land
 * in Phase 4 together with the unlock rule)
 * ------------------------------------------------------------------------- */

export const LessonStatusSchema = z.enum(["locked", "available", "completed"]);
export type LessonStatus = z.infer<typeof LessonStatusSchema>;

export const LessonProgressSchema = z.object({
  lessonId: z.string().min(1),
  status: LessonStatusSchema,
  bestWpm: z.number().min(0),
  bestAccuracy: z.number().min(0).max(100),
  lowestErrorRate: z.number().min(0).max(100),
  attemptCount: z.number().int().min(0),
  unlockedAt: z.number().int().nonnegative().nullable(),
  completedAt: z.number().int().nonnegative().nullable(),
  updatedAt: z.number().int().nonnegative(),
});
export type LessonProgress = z.infer<typeof LessonProgressSchema>;

/* ---------------------------------------------------------------------------
 * Attempts (PRD §10 — append-only; metric columns are never UPDATEd)
 *
 * Phase 6: the ledger is unified — `kind` splits lesson / weakness / adaptive
 * attempts, and `lessonId` is nullable because generated drills have no lesson
 * row. Drill metrics never touch lesson_progress (plan §2).
 * ------------------------------------------------------------------------- */

export const AttemptKindSchema = z.enum(["lesson", "weakness", "adaptive"]);
export type AttemptKind = z.infer<typeof AttemptKindSchema>;

/** Metric columns shared by every attempt kind (§10 — append-only). */
const AttemptMetricsShape = {
  attemptNumber: z.number().int().min(1),
  wpm: z.number().min(0),
  accuracy: z.number().min(0).max(100),
  errorRate: z.number().min(0).max(100),
  errorCount: z.number().int().min(0),
  correctChars: z.number().int().min(0),
  incorrectChars: z.number().int().min(0),
  backspaceCount: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  completed: z.boolean(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
} as const;

/** Lesson attempt (kind is always the DB default "lesson"; lessonId
 * references the module). */
export const AttemptSchema = z.object({
  lessonId: z.string().min(1),
  ...AttemptMetricsShape,
});
export type Attempt = z.infer<typeof AttemptSchema>;

/** Drill attempt (Phase 6 — lessonId NULL, kind weakness/adaptive). */
export const DrillAttemptSchema = z.object({
  lessonId: z.null(),
  kind: z.enum(["weakness", "adaptive"]),
  ...AttemptMetricsShape,
});
export type DrillAttempt = z.infer<typeof DrillAttemptSchema>;

export const DrillAttemptRowSchema = DrillAttemptSchema.extend({
  id: z.number().int().positive(),
});
export type DrillAttemptRow = z.infer<typeof DrillAttemptRowSchema>;

export const AttemptRowSchema = AttemptSchema.extend({
  id: z.number().int().positive(),
});
export type AttemptRow = z.infer<typeof AttemptRowSchema>;

/** One spotlighted character of a finished attempt (`key_report` json). */
export const KeyReportEntrySchema = z.object({
  /** Expected character (the char the user had to type). */
  key: z.string().min(1),
  shiftRequired: z.boolean(),
  totalPresses: z.number().int().min(0),
  incorrectPresses: z.number().int().min(0),
  avgLatencyMs: z.number().min(0),
});
export type KeyReportEntry = z.infer<typeof KeyReportEntrySchema>;

/** Full attempt row as read back incl. the per-attempt key spotlight. */
export const AttemptReportRowSchema = AttemptRowSchema.extend({
  keyReport: z.array(KeyReportEntrySchema).nullable(),
});
export type AttemptReportRow = z.infer<typeof AttemptReportRowSchema>;

/* ---------------------------------------------------------------------------
 * Key statistics (PRD §14 / §21.1 — one row per *character* with its
 * shift requirement, so `a`/`A` and `(`/`9` stay distinct)
 * ------------------------------------------------------------------------- */

/** A single keystroke's contribution, recorded by the engine per char. */
export const KeyStatEventSchema = z.object({
  /** Expected character (the *typed* char is not persisted per key). */
  key: z.string().min(1),
  shiftRequired: z.boolean(),
  correct: z.boolean(),
  latencyMs: z.number().min(0),
});
export type KeyStatEvent = z.infer<typeof KeyStatEventSchema>;

/** Aggregated row as stored in `key_statistics`. */
export const KeyStatRowSchema = z.object({
  key: z.string().min(1),
  shiftRequired: z.boolean(),
  totalPresses: z.number().int().min(0),
  correctPresses: z.number().int().min(0),
  incorrectPresses: z.number().int().min(0),
  avgLatencyMs: z.number().min(0),
  lastSeenAt: z.number().int().nonnegative(),
});
export type KeyStatRow = z.infer<typeof KeyStatRowSchema>;

/** Phase 6: one daily per-key rollup row (`key_statistics_daily`). */
export const KeyStatDailyRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date"),
  key: z.string().min(1),
  shiftRequired: z.boolean(),
  presses: z.number().int().min(0),
  correct: z.number().int().min(0),
});
export type KeyStatDailyRow = z.infer<typeof KeyStatDailyRowSchema>;

/** Phase 6: one planned-bigram rollup row (`bigram_statistics`). */
export const BigramStatRowSchema = z.object({
  pair: z.string().min(2).max(2),
  total: z.number().int().min(0),
  incorrect: z.number().int().min(0),
  avgLatencyMs: z.number().min(0),
});
export type BigramStatRow = z.infer<typeof BigramStatRowSchema>;

/* ---------------------------------------------------------------------------
 * Weakness queue + drill config (Phase 6 — persisted in `settings` §20)
 * ------------------------------------------------------------------------- */

export const WeakKeyStateSchema = z.enum(["targeted", "maintenance", "eliminated"]);
export type WeakKeyState = z.infer<typeof WeakKeyStateSchema>;

/** One persisted queue entry (settings key `weakness_queue`). */
export const QueueEntrySchema = z.object({
  key: z.string().min(1),
  shiftRequired: z.boolean(),
  state: WeakKeyStateSchema,
  /** Local day key ("YYYY-MM-DD") the current state was reached. */
  stateSince: z.string(),
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;

/** Drill configuration (design's 4 rows; editable UI arrives in Phase 7). */
export const DrillConfigSchema = z.object({
  /** Keystrokes per set (design: 120 keys). */
  setLength: z.number().int().min(40).max(400),
  /** Sets per drill session (design: 5). */
  sets: z.number().int().min(1).max(10),
  /** Weak-char injection weight, 1-5 (design: AGGRESSIVE ×3). */
  symbolWeight: z.number().int().min(1).max(5),
  /** Context corpus style (design: "Code identifiers"). */
  wordContext: z.enum(["code_identifiers", "plain"]),
  /** Backspace policy (design: "Counted" — engine already counts fix-ups). */
  backspacePolicy: z.enum(["counted", "ignored"]),
});
export type DrillConfig = z.infer<typeof DrillConfigSchema>;

/* ---------------------------------------------------------------------------
 * Training sessions (§21 — one row per app-level training session)
 * ------------------------------------------------------------------------- */

export const SessionKindSchema = z.enum([
  "lesson",
  "weakness",
  "custom",
  "adaptive",
]);
export type SessionKind = z.infer<typeof SessionKindSchema>;

export const TrainingSessionSchema = z.object({
  id: z.string().min(1),
  kind: SessionKindSchema,
  lessonId: z.string().min(1).nullable(),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  charsTyped: z.number().int().min(0),
});
export type TrainingSession = z.infer<typeof TrainingSessionSchema>;

/* ---------------------------------------------------------------------------
 * Engine session state (§22 transient shape, validated at the persistence
 * boundary — entries mirror `src/lib/engine/types.ts`)
 * ------------------------------------------------------------------------- */

export const CharStatusSchema = z.enum(["pending", "correct", "incorrect"]);

export const CharEntrySchema = z.object({
  expected: z.string().length(1),
  typed: z.string().length(1).nullable(),
  status: CharStatusSchema,
});

export const SessionStateSchema = z.object({
  content: z.string(),
  position: z.number().int().min(0),
  entries: z.array(CharEntrySchema),
  correctChars: z.number().int().min(0),
  incorrectChars: z.number().int().min(0),
  /** Character-producing keystrokes (chars + enter); backspaces excluded. */
  totalKeystrokes: z.number().int().min(0),
  backspaceCount: z.number().int().min(0),
  startedAt: z.number().int().nonnegative().nullable(),
  finishedAt: z.number().int().nonnegative().nullable(),
});
export type SessionStateData = z.infer<typeof SessionStateSchema>;

/** What `finish()` computes from the engine state and persists. */
export const SessionSummarySchema = AttemptSchema;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

/* ---------------------------------------------------------------------------
 * Custom lessons (§16 — full field set now so Phase 7 is pure UI)
 * ------------------------------------------------------------------------- */

export const CustomLessonDifficultySchema = z.enum(["easy", "medium", "hard"]);

export const CustomLessonSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().default(""),
  content: z
    .string()
    .min(1)
    .refine((c) => !c.includes("\t"), { message: "tabs are not supported" }),
  difficulty: CustomLessonDifficultySchema,
  targetKeys: z.array(z.string().min(1)).default([]),
  targetSymbols: z.array(z.string().min(1)).default([]),
  wpmTarget: z.number().min(0).nullable(),
  accuracyTarget: z.number().min(0).max(100).nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type CustomLesson = z.infer<typeof CustomLessonSchema>;

/* ---------------------------------------------------------------------------
 * Daily goals (§18 — table created now, used in Phase 8)
 * ------------------------------------------------------------------------- */

export const DailyGoalsSchema = z.object({
  /** ISO calendar date, e.g. "2026-09-05". */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected ISO date"),
  minutesGoal: z.number().int().min(0),
  lessonsGoal: z.number().int().min(0),
  charsGoal: z.number().int().min(0),
});
export type DailyGoals = z.infer<typeof DailyGoalsSchema>;

/* ---------------------------------------------------------------------------
 * Settings (§20 — key/value store used by the Settings screen in Phase 7)
 * ------------------------------------------------------------------------- */

export const SettingRowSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  updatedAt: z.number().int().nonnegative(),
});
export type SettingRow = z.infer<typeof SettingRowSchema>;
