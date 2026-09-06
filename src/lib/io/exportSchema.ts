import { z } from "zod";

import {
  AttemptKindSchema,
  BigramStatRowSchema,
  CustomLessonSchema,
  DailyGoalsSchema,
  KeyStatDailyRowSchema,
  KeyStatRowSchema,
  KeyReportEntrySchema,
  LessonProgressSchema,
  LessonSchema,
  SessionKindSchema,
  SettingRowSchema,
} from "../schemas";

/**
 * §17 portable export envelope — `typekernel.export.v1`.
 *
 * The SINGLE source of truth shared by the exporter (what we write) and the
 * importer (what we accept); the DB-layer Zod schemas are composed, never
 * re-declared, so writer and reader cannot drift (plan §2).
 *
 * §23: every envelope object is STRICT — unknown/misplaced fields (a
 * "mixed kinds" file, e.g. attempts smuggled into a custom-lessons payload)
 * are rejected, not silently stripped. Imports are only ever applied after
 * the WHOLE file parses and cross-row invariants hold (see importer.ts).
 */

export const EXPORT_FORMAT = "typekernel.export";

/** Current envelope version. Older versions migrate forward through
 * `VERSION_MIGRATIONS`; newer ones are REJECTED (never guessed at). */
export const CURRENT_EXPORT_VERSION = 1;

export const ExportKindSchema = z.enum([
  "custom-lessons",
  "collection",
  "progress-backup",
]);
export type ExportKind = z.infer<typeof ExportKindSchema>;

/** Shared envelope header fields (kind-specific payloads live in `payload`). */
const EnvelopeMetaShape = {
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.number().int().nonnegative(),
  appVersion: z.string().min(1),
} as const;

/* --------------------------------- payloads ------------------------------ */

/** One exported custom module — exactly the §16 DB schema. */
export const ExportedCustomLessonSchema = CustomLessonSchema;
export type ExportedCustomLesson = z.infer<typeof ExportedCustomLessonSchema>;

export const CustomLessonsPayloadSchema = z
  .object({
    lessons: z.array(ExportedCustomLessonSchema).min(1),
  })
  .strict();

/** A shareable collection: named group of modules imported together. */
export const CollectionPayloadSchema = z
  .object({
    collectionId: z.string().min(1),
    collectionName: z.string().min(1),
    lessons: z.array(ExportedCustomLessonSchema).min(1),
  })
  .strict();

/** A raw attempt row as stored in the unified ledger (§10), including its
 * `kind` and the per-attempt key spotlight. */
export const BackupAttemptRowSchema = z
  .object({
    id: z.number().int().positive(),
    lessonId: z.string().min(1).nullable(),
    kind: AttemptKindSchema,
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
    keyReport: z.array(KeyReportEntrySchema).nullable(),
  })
  .strict();
export type BackupAttemptRow = z.infer<typeof BackupAttemptRowSchema>;

/** Full local state (§27 "progress backups"): everything the app persists. */
export const ProgressBackupPayloadSchema = z
  .object({
    /** `lessons` rows back the FKs of progress/attempts/sessions (the
     * bundled curriculum is re-seeded on boot; these rows restore the
     * custom-module mirrors verbatim). */
    lessons: z.array(LessonSchema),
    progress: z.array(LessonProgressSchema),
    attempts: z.array(BackupAttemptRowSchema),
    keyStats: z.array(KeyStatRowSchema),
    keyStatsDaily: z.array(KeyStatDailyRowSchema),
    bigramStats: z.array(BigramStatRowSchema),
    customLessons: z.array(ExportedCustomLessonSchema),
    /** The whole §20 key/value table (incl. drill config + weakness queue). */
    settings: z.array(SettingRowSchema),
    dailyGoals: z.array(DailyGoalsSchema),
    sessions: z.array(
      z.object({
        id: z.string().min(1),
        kind: SessionKindSchema,
        lessonId: z.string().min(1).nullable(),
        startedAt: z.number().int().nonnegative(),
        endedAt: z.number().int().nonnegative().nullable(),
        durationMs: z.number().int().nonnegative().nullable(),
        charsTyped: z.number().int().min(0),
      }),
    ),
  })
  .strict();

export type ProgressBackupPayload = z.infer<typeof ProgressBackupPayloadSchema>;

/* --------------------------------- envelope ------------------------------ */

export const EnvelopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...EnvelopeMetaShape,
      kind: z.literal("custom-lessons"),
      payload: CustomLessonsPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...EnvelopeMetaShape,
      kind: z.literal("collection"),
      payload: CollectionPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...EnvelopeMetaShape,
      kind: z.literal("progress-backup"),
      payload: ProgressBackupPayloadSchema,
    })
    .strict(),
]);

export type ExportEnvelope = z.infer<typeof EnvelopeSchema>;

/* --------------------------- version migrations --------------------------- */

/**
 * Forward-only migration chain (plan §2): each entry upgrades a payload from
 * `version` N to N+1. v0 was a pre-release alias of the v1 shape, so its
 * step is a re-stamp. A version with no path to `CURRENT_EXPORT_VERSION`
 * (e.g. anything newer, or negative) is rejected with a readable error —
 * unknown versions are NEVER guessed at (§23).
 */
export const VERSION_MIGRATIONS: Record<
  number,
  (data: Record<string, unknown>) => Record<string, unknown>
> = {
  0: (data) => ({ ...data, version: 1 }),
};

export interface ParseFailure {
  ok: false;
  /** Human-readable issue list with JSON paths (§17 error dialog). */
  issues: string[];
}

export interface ParseSuccess {
  ok: true;
  envelope: ExportEnvelope;
}

/** Formats Zod issues as "path: message" lines (the §17 error dialog body). */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Upgrades a raw (already JSON-parsed) envelope to the current version.
 * Rejects unknown/newer versions outright.
 */
export function migrateToCurrent(
  raw: Record<string, unknown>,
): { ok: true; data: Record<string, unknown> } | { ok: false; issues: string[] } {
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    return {
      ok: false,
      issues: [`version: expected an integer envelope version, got ${JSON.stringify(version)}`],
    };
  }
  if (version > CURRENT_EXPORT_VERSION) {
    return {
      ok: false,
      issues: [
        `version: envelope v${version} is newer than this app supports (v${CURRENT_EXPORT_VERSION}) — update the app to import this file`,
      ],
    };
  }

  let data = raw;
  let current = version;
  while (current < CURRENT_EXPORT_VERSION) {
    const step = VERSION_MIGRATIONS[current];
    if (step === undefined) {
      return {
        ok: false,
        issues: [`version: no migration path from v${current} to v${CURRENT_EXPORT_VERSION}`],
      };
    }
    data = step(data);
    current += 1;
  }
  return { ok: true, data };
}

/** Strict parse of the migrated envelope (kind + payload in one pass). */
export function parseMigrated(data: Record<string, unknown>): ParseSuccess | ParseFailure {
  const result = EnvelopeSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, issues: formatIssues(result.error) };
  }
  return { ok: true, envelope: result.data };
}

/** The lessons any envelope kind carries (empty for progress backups). */
export function envelopeLessons(envelope: ExportEnvelope): ExportedCustomLesson[] {
  return envelope.kind === "progress-backup" ? [] : envelope.payload.lessons;
}
