import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { getLesson } from "../../content";
import { completeAttempt, buildKeyReport } from "./progressService";
import { progressRepo } from "../db/repositories";
import { seedCurriculum } from "./seed";
import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import type { LessonProgress } from "../schemas";

/**
 * Progress-service integration tests (Phase 4 plan §3.5): the §26 finish
 * pipeline against real SQLite — multi-attempt progression, replay
 * never re-locks, best-stats monotonicity, transactional attempt numbering.
 */

let sqlite: DatabaseSync;

beforeEach(() => {
  setDbForTests(null); // fresh singleton per test
  sqlite = connectTestDb();
});

afterAll(() => {
  setDbForTests(null);
});

const metrics = (wpm: number, accuracy: number, errorCount = 3) => ({
  wpm,
  accuracy,
  errorRate: 100 - accuracy,
  errorCount,
  correctChars: 200,
  incorrectChars: errorCount,
  backspaceCount: errorCount,
  durationMs: 45_000,
  startedAt: 1_000,
  finishedAt: 46_000,
});

const keyReport = [
  { key: "-", shiftRequired: false, totalPresses: 6, incorrectPresses: 2, avgLatencyMs: 190 },
  { key: ">", shiftRequired: true, totalPresses: 6, incorrectPresses: 1, avgLatencyMs: 150 },
];

async function statuses(ids: string[]): Promise<Array<[string, string]>> {
  const all = await progressRepo.all();
  const map = new Map(all.map((p) => [p.lessonId, p.status]));
  return ids.map((id) => [id, map.get(id) ?? "missing"]);
}

describe("seedCurriculum", () => {
  it("seeds 260 lessons with only l1-001 available, everything else locked", async () => {
    await seedCurriculum(1_000);
    const all = await progressRepo.all();
    expect(all.length).toBe(260);
    expect(all.find((p) => p.lessonId === "l1-001")?.status).toBe("available");
    expect(all.filter((p) => p.status === "locked").length).toBe(259);

    // Idempotent: reseeding keeps existing rows untouched.
    await seedCurriculum(2_000);
    const again = await progressRepo.all();
    expect(again.find((p) => p.lessonId === "l1-001")?.updatedAt).toBe(1_000);
    expect(again.length).toBe(260);
  });
});

describe("completeAttempt — §26 pipeline", () => {
  it("progresses FAIL -> FAIL -> PASS and unlocks exactly the next lesson", async () => {
    await seedCurriculum(1_000);

    const failLowSpeed = await completeAttempt(
      getLesson("l1-001")!,
      metrics(50, 93),
      keyReport,
      1_000,
    );
    expect(failLowSpeed.verdict).toBe("FAIL");
    expect(failLowSpeed.attempt.attemptNumber).toBe(1);
    expect(failLowSpeed.nextLessonId).toBeNull();

    const failLowAccuracy = await completeAttempt(
      getLesson("l1-001")!,
      metrics(44, 98),
      [],
      2_000,
    );
    expect(failLowAccuracy.verdict).toBe("FAIL");

    // Both failures leave the world untouched: l1-001 still available.
    expect(await statuses(["l1-001", "l1-002", "l1-003"])).toEqual([
      ["l1-001", "available"],
      ["l1-002", "locked"],
      ["l1-003", "locked"],
    ]);

    const pass = await completeAttempt(
      getLesson("l1-001")!,
      metrics(50, 95),
      keyReport,
      3_000,
    );
    expect(pass.verdict).toBe("PASS");
    expect(pass.grade).toBe("B");
    expect(pass.attempt.attemptNumber).toBe(3);
    expect(pass.nextLessonId).toBe("l1-002");

    // Exactly one lesson unlocked — the next in curriculum order.
    expect(await statuses(["l1-001", "l1-002", "l1-003", "l2-001"])).toEqual([
      ["l1-001", "completed"],
      ["l1-002", "available"],
      ["l1-003", "locked"],
      ["l2-001", "locked"],
    ]);

    const completedAt = (await progressRepo.get("l1-001")) as LessonProgress;
    expect(completedAt.completedAt).toBe(3_000);
    expect(completedAt.unlockedAt).toBe(1_000); // original unlock kept
  });

  it("replaying a completed lesson never re-locks later lessons", async () => {
    await seedCurriculum(1_000);
    await completeAttempt(getLesson("l1-001")!, metrics(50, 95), [], 1_000);
    await completeAttempt(getLesson("l1-002")!, metrics(55, 97), [], 2_000);
    expect(await statuses(["l1-002", "l1-003"])).toEqual([
      ["l1-002", "completed"],
      ["l1-003", "available"],
    ]);

    // A poor replay of l1-001 changes nothing about l1-002/l1-003.
    await completeAttempt(getLesson("l1-001")!, metrics(20, 60), [], 3_000);
    await completeAttempt(getLesson("l1-001")!, metrics(70, 99), [], 4_000);
    expect(await statuses(["l1-001", "l1-002", "l1-003"])).toEqual([
      ["l1-001", "completed"],
      ["l1-002", "completed"],
      ["l1-003", "available"],
    ]);

    const progress = (await progressRepo.get("l1-001")) as LessonProgress;
    expect(progress.attemptCount).toBe(3);
    expect(progress.completedAt).toBe(1_000); // first completion, not replay
  });

  it("keeps best-stats monotonic across attempts (§11)", async () => {
    await seedCurriculum();
    const lesson = getLesson("l1-001")!;

    await completeAttempt(lesson, metrics(40, 96, 8), [], 1_000);
    let progress = (await progressRepo.get(lesson.id)) as LessonProgress;
    expect(progress.bestWpm).toBe(40);
    expect(progress.bestAccuracy).toBe(96);
    expect(progress.lowestErrorRate).toBe(4);
    expect(progress.attemptCount).toBe(1);

    await completeAttempt(lesson, metrics(55, 98, 2), [], 2_000);
    await completeAttempt(lesson, metrics(45, 94, 12), [], 3_000);

    progress = (await progressRepo.get(lesson.id)) as LessonProgress;
    expect(progress.bestWpm).toBe(55); // max, not latest
    expect(progress.bestAccuracy).toBe(98);
    expect(progress.lowestErrorRate).toBe(2); // min, not latest
    expect(progress.attemptCount).toBe(3);
  });

  it("persists the per-attempt key report", async () => {
    await seedCurriculum();
    const outcome = await completeAttempt(
      getLesson("l1-001")!,
      metrics(50, 95),
      keyReport,
      1_000,
    );
    const raw = sqlite
      .prepare("SELECT key_report FROM lesson_attempts WHERE id = ?")
      .get(outcome.attempt.id) as { key_report: string | null };
    const report = JSON.parse(raw.key_report ?? "[]");
    expect(report[0]).toMatchObject({
      key: "-",
      incorrectPresses: 2,
      totalPresses: 6,
    });
  });
});

describe("buildKeyReport", () => {
  it("aggregates per char and ranks worst first (misses, then latency)", () => {
    const report = buildKeyReport([
      { key: "a", shiftRequired: false, totalPresses: 2, incorrectPresses: 0, avgLatencyMs: 50 },
      { key: "a", shiftRequired: false, totalPresses: 1, incorrectPresses: 1, avgLatencyMs: 100 },
      { key: ">", shiftRequired: true, totalPresses: 1, incorrectPresses: 1, avgLatencyMs: 300 },
      { key: "-", shiftRequired: false, totalPresses: 1, incorrectPresses: 1, avgLatencyMs: 400 },
    ], 3);
    expect(report).toHaveLength(3);
    expect(report[0]).toMatchObject({ key: "-", incorrectPresses: 1, totalPresses: 1, avgLatencyMs: 400 });
    expect(report[1]).toMatchObject({ key: ">", incorrectPresses: 1, avgLatencyMs: 300 });
    expect(report[2]).toMatchObject({ key: "a", totalPresses: 3, incorrectPresses: 1, avgLatencyMs: (50 + 50 + 100) / 3 });
  });
});
