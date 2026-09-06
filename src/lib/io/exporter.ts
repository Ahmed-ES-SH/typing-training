import {
  backupRepo,
  bigramStatsRepo,
  customLessonsRepo,
  keyStatsRepo,
  progressRepo,
  settingsRepo,
} from "../db/repositories";
import type { CustomLesson } from "../schemas";
import {
  CURRENT_EXPORT_VERSION,
  EXPORT_FORMAT,
  type ExportEnvelope,
  type ExportKind,
  type ExportedCustomLesson,
  type ProgressBackupPayload,
} from "./exportSchema";

/**
 * §17 exporter — builds envelope payloads from the repositories and
 * serializes them as pretty-printed, human-readable JSON (portable,
 * versioned, manually editable per §17). The Tauri save-dialog/file-write
 * plumbing lives in `fileIo.ts`; everything here is pure or repo-backed and
 * unit-testable headless.
 */

/** App version line for the envelope header (build-time constant). */
export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
}

export interface EnvelopeHeader {
  exportedAt: number;
  appVersion?: string;
}

function header<K extends ExportKind>(
  kind: K,
  at: number,
  version?: string,
): {
  format: typeof EXPORT_FORMAT;
  version: number;
  kind: K;
  exportedAt: number;
  appVersion: string;
} {
  return {
    format: EXPORT_FORMAT,
    version: CURRENT_EXPORT_VERSION,
    kind,
    exportedAt: at,
    appVersion: version ?? appVersion(),
  };
}

/** `typekernel-<kind>-<YYYY-MM-DD>.json` filename convention (plan §3.2). */
export function backupFilename(kind: ExportKind, at = Date.now()): string {
  const date = new Date(at).toISOString().slice(0, 10);
  return `typekernel-${kind}-${date}.json`;
}

/** Envelope for a set of custom modules (Export All, or one module). */
export function buildCustomLessonsEnvelope(
  lessons: CustomLesson[],
  { exportedAt, appVersion: version }: EnvelopeHeader,
): Extract<ExportEnvelope, { kind: "custom-lessons" }> {
  return {
    ...header("custom-lessons", exportedAt, version),
    payload: { lessons: lessons as ExportedCustomLesson[] },
  };
}

/** Envelope for a named collection (selected module ids). */
export function buildCollectionEnvelope(
  lessons: CustomLesson[],
  collectionId: string,
  collectionName: string,
  { exportedAt, appVersion: version }: EnvelopeHeader,
): Extract<ExportEnvelope, { kind: "collection" }> {
  return {
    ...header("collection", exportedAt, version),
    payload: {
      collectionId,
      collectionName,
      lessons: lessons as ExportedCustomLesson[],
    },
  };
}

/** Reads the ENTIRE local state into a progress-backup envelope. */
export async function collectBackup({
  exportedAt = Date.now(),
  appVersion: version,
}: { exportedAt?: number; appVersion?: string } = {}): Promise<
  Extract<ExportEnvelope, { kind: "progress-backup" }>
> {
  const [
    lessons,
    progress,
    attempts,
    keyStats,
    keyStatsDaily,
    bigramStats,
    customLessons,
    settings,
    dailyGoals,
    sessions,
  ] = await Promise.all([
    backupRepo.lessonsAll(),
    progressRepo.all(),
    backupRepo.attemptsAll(),
    keyStatsRepo.all(),
    keyStatsRepo.dailySince("0000-01-01"),
    bigramStatsRepo.all(0),
    customLessonsRepo.all(),
    settingsRepo.all(),
    backupRepo.dailyGoalsAll(),
    backupRepo.sessionsAll(),
  ]);
  const payload: ProgressBackupPayload = {
    lessons,
    progress,
    attempts,
    keyStats,
    keyStatsDaily,
    bigramStats,
    customLessons,
    settings,
    dailyGoals: dailyGoals as ProgressBackupPayload["dailyGoals"],
    sessions,
  };
  return {
    ...header("progress-backup", exportedAt, version),
    payload,
  };
}

/** Pretty-printed JSON — two-space indent so the file stays diffable. */
export function serializeEnvelope(envelope: ExportEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/** Convenience: Export All button payload (every custom module). */
export async function exportAllCustomLessons(
  header?: Partial<EnvelopeHeader>,
): Promise<string> {
  const lessons = await customLessonsRepo.all();
  return serializeEnvelope(
    buildCustomLessonsEnvelope(lessons, {
      exportedAt: header?.exportedAt ?? Date.now(),
      appVersion: header?.appVersion,
    }),
  );
}
