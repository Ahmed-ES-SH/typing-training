import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import { getLesson } from "../../content";
import {
  attemptsRepo,
  customLessonsRepo,
  keyStatsRepo,
  lessonsRepo,
  progressRepo,
  sessionsRepo,
  settingsRepo,
} from "../db/repositories";
import { bigramStatsRepo } from "../db/repositories";
import { CustomLessonSchema, type CustomLesson } from "../schemas";
import {
  CURRENT_EXPORT_VERSION,
  EXPORT_FORMAT,
  type ExportedCustomLesson,
} from "./exportSchema";
import {
  backupFilename,
  buildCollectionEnvelope,
  buildCustomLessonsEnvelope,
  collectBackup,
  serializeEnvelope,
} from "./exporter";
import {
  ImportRejectedError,
  applyEnvelope,
  crossRowIssues,
  importReport,
  parseEnvelope,
  planMerge,
} from "./importer";

/**
 * §17/§23 import-export suite. Core assertions:
 * 1. round-trip: export -> wipe -> import reproduces the EXACT state;
 * 2. the fuzz matrix (truncated JSON, wrong types, unknown version, mixed
 *    kinds) is rejected with ZERO DB writes — asserted by table row counts;
 * 3. merge collision rules; 4. custom-lesson CRUD/draft lifecycle.
 */

const T = 1_700_000_000_000;

function customFixture(overrides: Partial<CustomLesson> = {}): CustomLesson {
  return CustomLessonSchema.parse({
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    title: "Docker Compose Blocks",
    description: "compose files: services, build, ports",
    content: 'services:\n  web:\n    build: .\n    ports: ["3000:80"]',
    difficulty: "medium",
    targetKeys: [],
    targetSymbols: [":", '"', "["],
    wpmTarget: 45,
    accuracyTarget: 95,
    isDraft: false,
    source: "custom",
    collectionId: null,
    syntaxFamily: "YAML",
    tags: ["yaml"],
    createdAt: T,
    updatedAt: T,
    ...overrides,
  });
}

const BASE_ATTEMPT = {
  wpm: 52,
  accuracy: 96.5,
  errorRate: 3.5,
  errorCount: 4,
  correctChars: 210,
  incorrectChars: 6,
  backspaceCount: 3,
  durationMs: 48_000,
  completed: true,
  startedAt: T,
  finishedAt: T + 48_000,
};

const KEY_REPORT = [
  { key: ":", shiftRequired: true, totalPresses: 9, incorrectPresses: 3, avgLatencyMs: 190 },
];

/** Full raw dump of every table (JSON string) — the state-equality probe. */
function dumpAll(sqlite: DatabaseSync): string {
  const tables = [
    "bigram_statistics",
    "custom_lessons",
    "daily_goals",
    "key_statistics",
    "key_statistics_daily",
    "lesson_attempts",
    "lesson_progress",
    "lessons",
    "settings",
    "training_sessions",
  ];
  const dump: Record<string, unknown[]> = {};
  for (const table of tables) {
    dump[table] = sqlite
      .prepare(`SELECT * FROM ${table} ORDER BY 1`)
      .all() as unknown[];
  }
  return JSON.stringify(dump, null, 1);
}

function rowCount(sqlite: DatabaseSync, table: string): number {
  const rows = sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).all() as Array<{
    n: number;
  }>;
  return Number(rows[0].n);
}

async function seedFixtureState(): Promise<void> {
  // Curriculum lesson + progress + attempts (with key report).
  await lessonsRepo.upsert(getLesson("l1-001")!);
  await progressRepo.mergeAttemptStats(
    {
      lessonId: "l1-001",
      status: "available",
      bestWpm: 52,
      bestAccuracy: 96.5,
      lowestErrorRate: 3.5,
      attemptCount: 1,
      unlockedAt: T,
      completedAt: null,
      updatedAt: T,
    },
    T,
  );
  await attemptsRepo.insertWithKind(
    { lessonId: "l1-001", ...BASE_ATTEMPT },
    KEY_REPORT,
    "lesson",
  );
  // Drill attempt + custom attempt (the two other ledger kinds).
  await attemptsRepo.insertDrillAttempt(
    { kind: "weakness", ...BASE_ATTEMPT },
    [],
  );
  const custom = customFixture();
  await customLessonsRepo.insert(custom);
  await lessonsRepo.upsert({
    id: `custom-${custom.id}`,
    level: 7,
    orderIndex: 10_000,
    title: custom.title,
    description: custom.description,
    content: custom.content,
    targetKeys: [...custom.targetKeys, ...custom.targetSymbols],
    tags: custom.tags,
    source: "custom",
    createdAt: custom.createdAt,
  });
  await attemptsRepo.insertWithKind(
    { lessonId: `custom-${custom.id}`, ...BASE_ATTEMPT },
    KEY_REPORT,
    "custom",
  );
  // Key stats: lifetime + daily + bigram.
  const events = [
    { key: ":", shiftRequired: true, correct: false, latencyMs: 190 },
    { key: "a", shiftRequired: false, correct: true, latencyMs: 90 },
  ];
  await keyStatsRepo.recordBatch(events, T);
  await keyStatsRepo.recordDaily(events, "2026-09-05");
  await bigramStatsRepo.recordBatch(events);
  // Training session + settings.
  await sessionsRepo.open({
    id: "sess-1",
    kind: "lesson",
    lessonId: "l1-001",
    startedAt: T,
    endedAt: null,
    durationMs: null,
    charsTyped: 0,
  });
  await sessionsRepo.close("sess-1", T + 50_000, 50_000, 216);
  await settingsRepo.set("app_settings", { theme: "typekernel-dark" }, T);
  await settingsRepo.set("weakness_queue", [{ key: ":", shiftRequired: true, state: "targeted", stateSince: "2026-09-05" }], T);
}

let sqlite: DatabaseSync;

beforeAll(async () => {
  sqlite = connectTestDb();
  await seedFixtureState();
});

afterAll(() => {
  setDbForTests(null);
});

/* ------------------------------ schema round-trip ------------------------- */

describe("exportSchema", () => {
  it("round-trips an envelope through serialize -> parse", () => {
    const lessons = [customFixture()] as ExportedCustomLesson[];
    const envelope = buildCustomLessonsEnvelope(lessons, {
      exportedAt: T,
      appVersion: "0.1.0",
    });
    const parsed = parseEnvelope(serializeEnvelope(envelope));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.envelope).toEqual(envelope);
    }
  });

  it("rejects truncated / non-JSON files with a readable error", () => {
    const parsed = parseEnvelope('{"format": "typekernel.export", "kind":');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]).toMatch(/^json: not valid JSON/);
  });

  it("rejects wrong metric types (tampered attempt row) with JSON paths", async () => {
    const backup = await collectBackup({ exportedAt: T, appVersion: "0.1.0" });
    const tampered = JSON.parse(serializeEnvelope(backup));
    tampered.payload.attempts[0].wpm = "fast";
    tampered.payload.attempts[0].completed = "yes";
    const parsed = parseEnvelope(JSON.stringify(tampered));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      const joined = parsed.issues.join("\n");
      expect(joined).toContain("payload.attempts.0.wpm");
      expect(joined).toContain("payload.attempts.0.completed");
    }
  });

  it("rejects unknown/newer envelope versions instead of guessing", () => {
    const parsed = parseEnvelope(
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: CURRENT_EXPORT_VERSION + 3,
        kind: "custom-lessons",
        exportedAt: T,
        appVersion: "0.1.0",
        payload: { lessons: [] },
      }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues[0]).toContain("newer than this app supports");
  });

  it("migrates v0 envelopes forward to v1", () => {
    const lessons = [customFixture()] as ExportedCustomLesson[];
    const envelope = buildCustomLessonsEnvelope(lessons, {
      exportedAt: T,
      appVersion: "0.1.0",
    });
    const raw = JSON.parse(serializeEnvelope(envelope));
    raw.version = 0; // pre-release alias of the v1 shape
    const parsed = parseEnvelope(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
  });

  it("rejects mixed kinds (attempts smuggled into a lessons payload)", () => {
    const envelope = buildCustomLessonsEnvelope([customFixture()], {
      exportedAt: T,
      appVersion: "0.1.0",
    });
    const mixed = JSON.parse(serializeEnvelope(envelope));
    mixed.payload.attempts = [{ id: 1, wpm: 50 }];
    const parsed = parseEnvelope(JSON.stringify(mixed));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.issues.join("\n")).toContain("attempts");
  });
});

/* --------------------------- merge collision rules ------------------------- */

describe("planMerge (§2 collision rules)", () => {
  const existingOlder = customFixture({ updatedAt: T });
  const incomingNewer = customFixture({ updatedAt: T + 5 });
  const incomingOlder = customFixture({ updatedAt: T - 5 });
  const brandNew = customFixture({
    id: "aa0d4dbe-0000-4000-8000-000000000001",
    updatedAt: T,
  });

  it("adds unseen ids, updates when the file copy is newer, keeps otherwise", () => {
    const plan = planMerge([existingOlder], [incomingNewer, incomingOlder, brandNew]);
    expect(plan.added.map((l) => l.id)).toEqual([brandNew.id]);
    expect(plan.updated.map((l) => l.id)).toEqual([incomingNewer.id]);
    expect(plan.kept.map((l) => l.id)).toEqual([existingOlder.id]);
  });

  it("rename strategy imports collisions under a fresh id", () => {
    const plan = planMerge([existingOlder], [incomingNewer], "rename");
    expect(plan.renamed).toHaveLength(1);
    expect(plan.renamed[0].id).not.toBe(incomingNewer.id);
    expect(plan.updated).toHaveLength(0);
  });

  it("marks collection imports as imported + collection id", () => {
    const plan = planMerge([], [customFixture()], "keep-newer", {
      collectionId: "coll-1",
    });
    expect(plan.added[0]).toMatchObject({ source: "imported", collectionId: "coll-1" });
  });
});

/* ------------------------- atomicity + zero-write gate --------------------- */

describe("importer atomicity (§23)", () => {
  const TABLES = [
    "bigram_statistics",
    "custom_lessons",
    "daily_goals",
    "key_statistics",
    "key_statistics_daily",
    "lesson_attempts",
    "lesson_progress",
    "lessons",
    "settings",
    "training_sessions",
  ];

  function counts(): Record<string, number> {
    return Object.fromEntries(TABLES.map((t) => [t, rowCount(sqlite, t)]));
  }

  it("rejects truncated JSON with zero DB writes", async () => {
    const before = counts();
    const parsed = parseEnvelope('{"format": "typekernel.exp');
    expect(parsed.ok).toBe(false);
    expect(counts()).toEqual(before);
  });

  it("rejects wrong types with zero DB writes", async () => {
    const before = counts();
    const backup = await collectBackup({ exportedAt: T, appVersion: "0.1.0" });
    const tampered = JSON.parse(serializeEnvelope(backup)) as Record<string, unknown>;
    const attempts = (tampered.payload as Record<string, unknown>).attempts as Array<
      Record<string, unknown>
    >;
    attempts[0].wpm = { value: 999 }; // wrong type
    const parsed = parseEnvelope(JSON.stringify(tampered));
    expect(parsed.ok).toBe(false);
    expect(counts()).toEqual(before);
  });

  it("rejects unknown versions with zero DB writes", async () => {
    const before = counts();
    const parsed = parseEnvelope(
      JSON.stringify({
        format: EXPORT_FORMAT,
        version: 99,
        kind: "custom-lessons",
        exportedAt: T,
        appVersion: "0.1.0",
        payload: { lessons: [] },
      }),
    );
    expect(parsed.ok).toBe(false);
    expect(counts()).toEqual(before);
  });

  it("rejects mixed kinds with zero DB writes", async () => {
    const before = counts();
    const envelope = buildCustomLessonsEnvelope([customFixture()], {
      exportedAt: T,
      appVersion: "0.1.0",
    });
    const mixed = JSON.parse(serializeEnvelope(envelope));
    mixed.payload.attempts = [{ id: 1, wpm: 50 }];
    const parsed = parseEnvelope(JSON.stringify(mixed));
    expect(parsed.ok).toBe(false);
    expect(counts()).toEqual(before);
  });

  it("rejects cross-row violations (FK target, duplicate ids) with zero writes", async () => {
    const before = counts();
    const backup = await collectBackup({ exportedAt: T, appVersion: "0.1.0" });
    // Attempt referencing a lesson id that is not in the payload.
    const broken = JSON.parse(serializeEnvelope(backup)) as Record<string, unknown>;
    const payload = broken.payload as Record<string, unknown>;
    (payload.attempts as Array<Record<string, unknown>>).push({
      id: 99_999,
      lessonId: "ghost-lesson",
      kind: "lesson",
      attemptNumber: 1,
      wpm: 10,
      accuracy: 10,
      errorRate: 90,
      errorCount: 0,
      correctChars: 0,
      incorrectChars: 0,
      backspaceCount: 0,
      durationMs: 1,
      completed: true,
      startedAt: 1,
      finishedAt: 2,
      keyReport: null,
    });
    const parsed = parseEnvelope(JSON.stringify(broken));
    expect(parsed.ok).toBe(true); // schema-valid but…
    if (parsed.ok) {
      expect(crossRowIssues(parsed.envelope).join("\n")).toContain("ghost-lesson");
      await expect(applyEnvelope(parsed.envelope, { confirmReplace: true })).rejects.toThrow(
        ImportRejectedError,
      );
    }
    expect(counts()).toEqual(before);
  });

  it("refuses unconfirmed replace-all backups with zero writes", async () => {
    const before = counts();
    const backup = await collectBackup({ exportedAt: T, appVersion: "0.1.0" });
    await expect(applyEnvelope(backup)).rejects.toThrow(/typed confirmation/);
    expect(counts()).toEqual(before);
  });

  it("rolls back the whole transaction when a write fails mid-apply", async () => {
    // The importer's own validation catches every in-file problem BEFORE the
    // first write; this proves the transaction harness underneath the apply
    // path (same `db.transaction` over the sqlite proxy) fully ROLLS BACK on
    // a mid-write failure — belt and suspenders for §23.
    const { getDb } = await import("../db/client");
    const { customLessons } = await import("../db/schema");
    const { sql } = await import("drizzle-orm");
    const before = rowCount(sqlite, "custom_lessons");
    await expect(
      (async () => {
        const db = await getDb();
        await db.transaction(async (tx) => {
          await tx.insert(customLessons).values(
            customFixture({ id: "ee0d4dbe-0000-4000-8000-000000000005" }),
          );
          // Duplicate primary key: guaranteed SQL error mid-transaction.
          await tx.run(
            sql`insert into custom_lessons (id, title, description, content, difficulty, target_keys, target_symbols, wpm_target, accuracy_target, is_draft, source, collection_id, syntax_family, tags, created_at, updated_at) values ('ee0d4dbe-0000-4000-8000-000000000005', 'x', '', 'y', 'easy', '[]', '[]', null, null, 0, 'custom', null, '', '[]', 1, 1)`,
          );
        });
      })(),
    ).rejects.toThrow();
    expect(rowCount(sqlite, "custom_lessons")).toBe(before);
  });
});

/* ------------------------------ full round-trip ---------------------------- */

describe("progress-backup round-trip (§27)", () => {
  it("export -> wipe -> import reproduces the identical DB state", async () => {
    const backup = await collectBackup({ exportedAt: T, appVersion: "0.1.0" });
    const before = dumpAll(sqlite);

    // WIPE: fresh in-memory DB with the real migrations (the reset flow's
    // delete + re-migrate, at the test-harness level).
    sqlite = connectTestDb();
    expect(rowCount(sqlite, "lesson_attempts")).toBe(0);

    const result = await applyEnvelope(backup, { confirmReplace: true });
    expect(result).toEqual({ replaced: true });
    expect(dumpAll(sqlite)).toBe(before);
  });

  it("imports custom-lesson envelopes as merges with a report", async () => {
    const envelope = buildCollectionEnvelope(
      [customFixture({ id: "bb0d4dbe-0000-4000-8000-000000000002" })],
      "coll-77",
      "Vim Motion Drills",
      { exportedAt: T, appVersion: "0.1.0" },
    );
    const parsed = parseEnvelope(serializeEnvelope(envelope));
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.envelope.kind === "collection") {
      const before = rowCount(sqlite, "custom_lessons");
      const report = importReport(
        parsed.envelope,
        planMerge(await customLessonsRepo.all(), parsed.envelope.payload.lessons),
      );
      expect(report.join(" ")).toContain("1 to ADD");
      const plan = await applyEnvelope(parsed.envelope);
      expect(plan).toMatchObject({ added: [expect.anything()] });
      expect(rowCount(sqlite, "custom_lessons")).toBe(before + 1);
      const imported = await customLessonsRepo.get("bb0d4dbe-0000-4000-8000-000000000002");
      expect(imported).toMatchObject({
        source: "imported",
        collectionId: "coll-77",
        tags: ["yaml", "collection:Vim Motion Drills"],
      });
    }
  });
});

/* ---------------------------- misc conventions ----------------------------- */

describe("exporter conventions", () => {
  it("uses the typekernel-<kind>-<date> filename convention", () => {
    expect(backupFilename("progress-backup", T)).toBe("typekernel-progress-backup-2023-11-14.json");
    expect(backupFilename("collection", T)).toBe("typekernel-collection-2023-11-14.json");
  });
});

/* ------------------------- customLessonsRepo lifecycle ---------------------- */

describe("customLessonsRepo (§16 lifecycle)", () => {
  it("creates, toggles drafts, publishes, updates and deletes", async () => {
    const lesson = customFixture({ id: "cc0d4dbe-0000-4000-8000-000000000003", isDraft: true });
    await customLessonsRepo.insert(lesson);
    expect(await customLessonsRepo.get(lesson.id)).toMatchObject({ isDraft: true });

    // Draft lifecycle: publish.
    const published = await customLessonsRepo.update(lesson.id, { isDraft: false }, T + 10);
    expect(published).toMatchObject({ isDraft: false, updatedAt: T + 10 });

    // Edit bumps updated_at.
    const edited = await customLessonsRepo.update(lesson.id, { title: "Renamed" }, T + 20);
    expect(edited).toMatchObject({ title: "Renamed" });

    // Listed, newest activity first.
    const all = await customLessonsRepo.all();
    expect(all[0].id).toBe(lesson.id);

    // Delete removes the module; its attempts stay in the ledger (§10).
    await customLessonsRepo.remove(lesson.id);
    expect(await customLessonsRepo.get(lesson.id)).toBeNull();
    const stats = await attemptsRepo.customStats(`custom-${lesson.id}`);
    expect(stats.attempts).toBe(0); // none for THIS module id in the round-trip DB
  });

  it("rejects invalid modules before SQL runs", async () => {
    const valid = customFixture({ id: "dd0d4dbe-0000-4000-8000-000000000004" });
    await expect(
      customLessonsRepo.insert({ ...valid, content: "has\ttab" }),
    ).rejects.toThrow();
    expect(await customLessonsRepo.get(valid.id)).toBeNull();
  });

  it("records kind='custom' attempts with per-kind numbering", async () => {
    const ref = "custom-cc0d4dbe-0000-4000-8000-000000000003-gone";
    await lessonsRepo.upsert({
      id: ref,
      level: 7,
      orderIndex: 10_000,
      title: "Ghost",
      description: "",
      content: "x",
      targetKeys: [],
      tags: [],
      source: "custom",
      createdAt: T,
    });
    await attemptsRepo.insertWithKind({ lessonId: ref, ...BASE_ATTEMPT });
    const second = await attemptsRepo.insertWithKind(
      { lessonId: ref, ...BASE_ATTEMPT },
      [],
      "custom",
    );
    expect(second.attemptNumber).toBe(1); // numbering is scoped by kind
    const kinds = sqlite
      .prepare(
        "SELECT kind, count(*) AS n FROM lesson_attempts WHERE lesson_id = ? GROUP BY kind ORDER BY kind",
      )
      .all(ref) as Array<{ kind: string; n: number }>;
    expect(kinds).toEqual([
      { kind: "custom", n: 1 },
      { kind: "lesson", n: 1 },
    ]);

    const stats = await attemptsRepo.customStats(ref);
    expect(stats).toEqual({ attempts: 1, bestWpm: 52, bestAccuracy: 96.5 });
  });
});

/* --------------------------- settings persistence -------------------------- */

describe("settingsRepo bulk (§20 backups)", () => {
  it("reads all rows and replaces the table wholesale", async () => {
    const rows = await settingsRepo.all();
    expect(rows.length).toBeGreaterThan(0);

    await settingsRepo.replaceAll([
      { key: "app_settings", value: { theme: "terminal-mono" }, updatedAt: T + 99 },
    ]);
    expect(await settingsRepo.all()).toEqual([
      { key: "app_settings", value: { theme: "terminal-mono" }, updatedAt: T + 99 },
    ]);
  });
});
