import { CURRICULUM_LESSONS, FIRST_LESSON_ID } from "../../content";
import { lessonsRepo, progressRepo } from "../db/repositories";
import type { LessonProgress } from "../schemas";

/**
 * Curriculum seeding (Phase 4 plan §3.4).
 *
 * Idempotent: bundled lesson rows are upserted (content revisions update the
 * row, progress/attempts stay keyed by id), and missing `lesson_progress`
 * rows are initialized with the first lesson `available` and everything else
 * `locked` — existing progress rows are never touched. New lessons in later
 * releases simply appear as new locked rows.
 */
export async function seedCurriculum(now = Date.now()): Promise<void> {
  // ONE multi-row upsert per table (not 260 per-row IPC round trips — that
  // loop was the startup long pole against the §25 1500 ms boot budget).
  await lessonsRepo.upsertMany(CURRICULUM_LESSONS);

  const existing = await progressRepo.all();
  const seeded = new Set(existing.map((row) => row.lessonId));

  const missing: LessonProgress[] = CURRICULUM_LESSONS.filter(
    (lesson) => !seeded.has(lesson.id),
  ).map((lesson) => ({
    lessonId: lesson.id,
    status: lesson.id === FIRST_LESSON_ID ? "available" : "locked",
    bestWpm: 0,
    bestAccuracy: 0,
    lowestErrorRate: 100,
    attemptCount: 0,
    unlockedAt: lesson.id === FIRST_LESSON_ID ? now : null,
    completedAt: null,
    updatedAt: now,
  }));
  await progressRepo.upsertMany(missing);
}
