import { backupRepo, customLessonsRepo } from "../db/repositories";
import { getDb } from "../db/client";
import {
  bigramStatistics,
  customLessons,
  dailyGoals as dailyGoalsTable,
  keyStatistics,
  keyStatisticsDaily,
  lessonAttempts,
  lessonProgress,
  lessons as lessonsTable,
  settings as settingsTable,
  trainingSessions,
} from "../db/schema";
import type { CustomLesson } from "../schemas";
import {
  type ExportEnvelope,
  type ExportedCustomLesson,
  type ParseFailure,
  type ParseSuccess,
  migrateToCurrent,
  parseMigrated,
} from "./exportSchema";

/**
 * §17 importer + §23 validation gate.
 *
 * PIPELINE: raw text -> JSON.parse -> version migration (forward-only) ->
 * strict Zod envelope parse -> cross-row invariant checks -> pre-import
 * report -> ONE SQLite transaction applying the plan.
 *
 * ATOMICITY (§23 "invalid imported data must never corrupt the local
 * database"): nothing is written until the whole file has parsed and every
 * cross-row invariant holds; the apply itself runs inside a single
 * transaction, so even a mid-write failure rolls back completely.
 */

/** Parses raw file text into a migrated, fully-validated envelope. */
export function parseEnvelope(text: string): ParseSuccess | ParseFailure {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [
        `json: not valid JSON (${error instanceof Error ? error.message : "parse error"}) — the file may be truncated or corrupted`,
      ],
    };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: ["envelope: expected a JSON object envelope"] };
  }
  const migrated = migrateToCurrent(raw as Record<string, unknown>);
  if (!migrated.ok) return migrated;
  return parseMigrated(migrated.data);
}

/* --------------------------- cross-row validation -------------------------- */

/** Duplicate detection helper — returns the first duplicated key, if any. */
function firstDuplicate<T>(items: T[], keyOf: (item: T) => string): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

/**
 * Invariants Zod cannot express (row-level uniqueness + FK integrity).
 * Every violation is collected — the report shows ALL problems at once.
 * Returns issue lines; empty = safe to apply.
 */
export function crossRowIssues(envelope: ExportEnvelope): string[] {
  const issues: string[] = [];
  const modules: ExportedCustomLesson[] =
    envelope.kind === "progress-backup"
      ? envelope.payload.customLessons
      : envelope.payload.lessons;

  const dupModule = firstDuplicate(modules, (l) => l.id);
  if (dupModule !== null) {
    issues.push(`customLessons: duplicate module id "${dupModule}" in file`);
  }

  if (envelope.kind !== "progress-backup") return issues;

  const p = envelope.payload;
  const lessonIds = new Set(p.lessons.map((l) => l.id));

  const dupRow = firstDuplicate(p.lessons, (l) => l.id);
  if (dupRow !== null) issues.push(`lessons: duplicate lesson id "${dupRow}" in file`);

  const dupAttempt = firstDuplicate(p.attempts, (a) => String(a.id));
  if (dupAttempt !== null) {
    issues.push(`attempts: duplicate attempt id "${dupAttempt}" in file`);
  }
  for (const attempt of p.attempts) {
    if (attempt.lessonId !== null && !lessonIds.has(attempt.lessonId)) {
      issues.push(
        `attempts: attempt ${attempt.id} references missing lesson "${attempt.lessonId}"`,
      );
    }
  }

  const dupProgress = firstDuplicate(p.progress, (r) => r.lessonId);
  if (dupProgress !== null) {
    issues.push(`progress: duplicate progress row for "${dupProgress}" in file`);
  }
  for (const row of p.progress) {
    if (!lessonIds.has(row.lessonId)) {
      issues.push(`progress: row references missing lesson "${row.lessonId}"`);
    }
  }

  const dupSession = firstDuplicate(p.sessions, (s) => s.id);
  if (dupSession !== null) {
    issues.push(`sessions: duplicate session id "${dupSession}" in file`);
  }
  for (const session of p.sessions) {
    if (session.lessonId !== null && !lessonIds.has(session.lessonId)) {
      issues.push(
        `sessions: session "${session.id}" references missing lesson "${session.lessonId}"`,
      );
    }
  }

  const dupKeyStat = firstDuplicate(p.keyStats, (r) => `${r.key}\u0000${r.shiftRequired}`);
  if (dupKeyStat !== null) issues.push(`keyStats: duplicate key row "${dupKeyStat}" in file`);

  const dupDaily = firstDuplicate(
    p.keyStatsDaily,
    (r) => `${r.date}\u0000${r.key}\u0000${r.shiftRequired}`,
  );
  if (dupDaily !== null) {
    issues.push(`keyStatsDaily: duplicate daily row "${dupDaily}" in file`);
  }

  const dupBigram = firstDuplicate(p.bigramStats, (r) => r.pair);
  if (dupBigram !== null) issues.push(`bigramStats: duplicate pair "${dupBigram}" in file`);

  const dupSetting = firstDuplicate(p.settings, (r) => r.key);
  if (dupSetting !== null) issues.push(`settings: duplicate key "${dupSetting}" in file`);

  const dupGoal = firstDuplicate(p.dailyGoals, (r) => r.date);
  if (dupGoal !== null) issues.push(`dailyGoals: duplicate date "${dupGoal}" in file`);

  return issues;
}

/* ------------------------------ merge planning ----------------------------- */

/** How an id collision resolves (plan §2: keep-newer is the default). */
export type CollisionStrategy = "keep-newer" | "rename";

export interface MergePlan {
  /** Modules that will be newly inserted. */
  added: ExportedCustomLesson[];
  /** Modules that will OVERWRITE an existing row (file copy is newer). */
  updated: ExportedCustomLesson[];
  /** Existing modules kept as-is (local copy is newer). */
  kept: ExportedCustomLesson[];
  /** Renamed copies (rename strategy) — new id, original content. */
  renamed: ExportedCustomLesson[];
}

/**
 * Pure §2 merge rule for custom-lessons/collection imports:
 * - no collision -> add;
 * - collision + keep-newer -> whichever row has the newer `updated_at` wins;
 * - collision + rename -> the incoming module gets a fresh id and is added
 *   alongside the existing one ("rename-on-import" dialog choice).
 * Collections mark their modules `source='imported'` + `collectionId`.
 */
export function planMerge(
  existing: CustomLesson[],
  incoming: ExportedCustomLesson[],
  strategy: CollisionStrategy = "keep-newer",
  collection: { collectionId: string; collectionName?: string } | null = null,
): MergePlan {
  const plan: MergePlan = { added: [], updated: [], kept: [], renamed: [] };
  const existingById = new Map(existing.map((l) => [l.id, l]));
  for (const raw of incoming) {
    let lesson: ExportedCustomLesson = { ...raw };
    if (collection !== null) {
      lesson = {
        ...lesson,
        source: "imported",
        collectionId: collection.collectionId,
        // Keep the collection's display name as a tag (the schema has no
        // dedicated column; the collection card reads it back).
        tags: [
          ...lesson.tags.filter((tag) => !tag.startsWith("collection:")),
          ...(collection.collectionName !== undefined
            ? [`collection:${collection.collectionName}`]
            : []),
        ],
      };
    }
    const current = existingById.get(lesson.id);
    if (current === undefined) {
      plan.added.push(lesson);
      continue;
    }
    if (strategy === "rename") {
      plan.renamed.push({ ...lesson, id: crypto.randomUUID() });
      continue;
    }
    if (lesson.updatedAt > current.updatedAt) plan.updated.push(lesson);
    else plan.kept.push(current);
  }
  return plan;
}

/** Human-readable pre-import report (the confirm-dialog content). */
export function importReport(
  envelope: ExportEnvelope,
  plan: MergePlan | null,
): string[] {
  if (envelope.kind === "progress-backup") {
    const p = envelope.payload;
    return [
      "REPLACE ALL local data with the backup contents:",
      `${p.progress.length} lesson-progress rows • ${p.attempts.length} attempts • ${p.keyStats.length} key-stat rows`,
      `${p.customLessons.length} custom modules • ${p.settings.length} settings keys • ${p.sessions.length} sessions`,
      "Everything not in the backup is lost — this cannot be undone.",
    ];
  }
  if (plan === null) return ["Nothing to import."];
  const lines = [`Merge ${envelope.payload.lessons.length} module(s) into your library:`];
  if (plan.added.length > 0) lines.push(`${plan.added.length} to ADD`);
  if (plan.updated.length > 0) lines.push(`${plan.updated.length} to UPDATE (file copy is newer)`);
  if (plan.kept.length > 0) lines.push(`${plan.kept.length} kept (your copy is newer)`);
  if (plan.renamed.length > 0) {
    lines.push(`${plan.renamed.length} imported as copies (id collision)`);
  }
  return lines;
}

/* --------------------------------- apply ---------------------------------- */

export class ImportRejectedError extends Error {
  constructor(issues: string[]) {
    super(`Import rejected:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "ImportRejectedError";
  }
}

/**
 * Applies a FULLY VALIDATED envelope atomically. Throws ImportRejectedError
 * (before ANY write) when cross-row invariants fail, or when an
 * unconfirmed replace-all backup arrives. Returns the merge plan / replace
 * marker for the UI.
 */
export async function applyEnvelope(
  envelope: ExportEnvelope,
  options: {
    strategy?: CollisionStrategy;
    /** User typed confirmation for the replace-all path (plan §2). */
    confirmReplace?: boolean;
  } = {},
): Promise<MergePlan | { replaced: true }> {
  const rowIssues = crossRowIssues(envelope);
  if (rowIssues.length > 0) throw new ImportRejectedError(rowIssues);

  const db = await getDb();

  if (envelope.kind === "progress-backup") {
    if (options.confirmReplace !== true) {
      throw new ImportRejectedError([
        "progress-backup replaces ALL local data and requires explicit typed confirmation",
      ]);
    }
    const p = envelope.payload;
    await db.transaction(async (tx) => {
      // FK-safe order: children first on delete, parents first on insert.
      await backupRepo.deleteAllForRestore(tx);
      if (p.lessons.length > 0) await tx.insert(lessonsTable).values(p.lessons);
      if (p.progress.length > 0) await tx.insert(lessonProgress).values(p.progress);
      if (p.attempts.length > 0) await tx.insert(lessonAttempts).values(p.attempts);
      if (p.keyStats.length > 0) await tx.insert(keyStatistics).values(p.keyStats);
      if (p.keyStatsDaily.length > 0) {
        await tx.insert(keyStatisticsDaily).values(p.keyStatsDaily);
      }
      if (p.bigramStats.length > 0) await tx.insert(bigramStatistics).values(p.bigramStats);
      if (p.customLessons.length > 0) {
        await tx.insert(customLessons).values(p.customLessons);
      }
      if (p.sessions.length > 0) await tx.insert(trainingSessions).values(p.sessions);
      if (p.dailyGoals.length > 0) await tx.insert(dailyGoalsTable).values(p.dailyGoals);
      // Settings last: the app's own keys arrive with the backup.
      await tx.delete(settingsTable);
      if (p.settings.length > 0) await tx.insert(settingsTable).values(p.settings);
    });
    return { replaced: true };
  }

  // custom-lessons / collection -> merge (§2).
  const collection =
    envelope.kind === "collection"
      ? {
          collectionId: envelope.payload.collectionId,
          collectionName: envelope.payload.collectionName,
        }
      : null;
  const plan = planMerge(
    await customLessonsRepo.all(),
    envelope.payload.lessons,
    options.strategy ?? "keep-newer",
    collection,
  );
  const writes: ExportedCustomLesson[] = [...plan.added, ...plan.updated, ...plan.renamed];
  if (writes.length > 0) {
    await db.transaction(async (tx) => {
      // Row-level upsert with a full-row overwrite SET: planMerge already
      // decided these rows win (newer updated_at / fresh ids).
      for (const row of writes) {
        await tx
          .insert(customLessons)
          .values(row)
          .onConflictDoUpdate({ target: customLessons.id, set: row });
      }
    });
  }
  return plan;
}
