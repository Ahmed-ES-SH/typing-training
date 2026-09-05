import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { getLesson } from "../content";
import { setDbForTests } from "../lib/db/client";
import { connectTestDb } from "../lib/db/testing";
import { lessonsRepo } from "../lib/db/repositories";
import { seedCurriculum } from "../lib/curriculum/seed";
import { useSessionStore } from "./useSessionStore";

/**
 * §3.7 abandon-path test: navigating away mid-session closes the
 * `training_sessions` row (ended_at set, chars kept) and writes NO attempt
 * row — attempt counters and the §12 aggregates stay unpolluted.
 */

let sqlite: DatabaseSync;

beforeEach(async () => {
  sqlite = connectTestDb();
  await seedCurriculum();
});

afterAll(() => {
  setDbForTests(null);
});

describe("useSessionStore abandon (§3.7)", () => {
  it("closes the session row and writes no attempt when leaving mid-session", async () => {
    await lessonsRepo.upsert(getLesson("l1-002")!);
    const store = useSessionStore.getState();
    await store.startLesson(getLesson("l1-002")!);

    // Type a few chars so the abandoned session has real char counts.
    useSessionStore.getState().typeChar("c");
    useSessionStore.getState().typeChar("o");
    useSessionStore.getState().typeChar("n");
    expect(useSessionStore.getState().phase).toBe("running");

    const sessionId = useSessionStore.getState().trainingSessionId;
    expect(sessionId).not.toBeNull();

    await useSessionStore.getState().abandon();

    // Store reset, no attempt persisted.
    const state = useSessionStore.getState();
    expect(state.phase).toBe("idle");
    expect(state.trainingSessionId).toBeNull();

    const sessionRow = sqlite
      .prepare("SELECT ended_at, duration_ms, chars_typed FROM training_sessions WHERE id = ?")
      .get(sessionId) as {
      ended_at: number | null;
      duration_ms: number | null;
      chars_typed: number;
    };
    expect(sessionRow.ended_at).not.toBeNull();
    expect(sessionRow.duration_ms).not.toBeNull();
    expect(sessionRow.chars_typed).toBe(3);

    const attemptCount = (
      sqlite.prepare("SELECT count(*) AS n FROM lesson_attempts").get() as { n: number }
    ).n;
    expect(attemptCount).toBe(0);

    // Progress counters untouched.
    const progress = (
      sqlite
        .prepare("SELECT attempt_count FROM lesson_progress WHERE lesson_id = 'l1-002'")
        .get() as { attempt_count: number }
    ).attempt_count;
    expect(progress).toBe(0);
  });

  it("abandon is a no-op when no session is running", async () => {
    await useSessionStore.getState().abandon();
    expect(useSessionStore.getState().phase).toBe("idle");
    const openRows = (
      sqlite
        .prepare("SELECT count(*) AS n FROM training_sessions WHERE ended_at IS NULL")
        .get() as { n: number }
    ).n;
    expect(openRows).toBe(0);
  });

  it("starting a new lesson while one runs abandons the previous session", async () => {
    await lessonsRepo.upsert(getLesson("l1-002")!);
    await lessonsRepo.upsert(getLesson("l1-003")!);
    await useSessionStore.getState().startLesson(getLesson("l1-002")!);
    const firstSessionId = useSessionStore.getState().trainingSessionId;
    useSessionStore.getState().typeChar("a");

    await useSessionStore.getState().startLesson(getLesson("l1-003")!);

    // The first session row was closed by the abandon path.
    const firstRow = sqlite
      .prepare("SELECT ended_at FROM training_sessions WHERE id = ?")
      .get(firstSessionId) as { ended_at: number | null };
    expect(firstRow.ended_at).not.toBeNull();

    // Exactly one open session remains (the new one).
    const openRows = sqlite
      .prepare("SELECT id FROM training_sessions WHERE ended_at IS NULL")
      .all() as Array<{ id: string }>;
    expect(openRows.map((row) => row.id)).toEqual([
      useSessionStore.getState().trainingSessionId,
    ]);

    await useSessionStore.getState().abandon();
  });
});
