import {
  CURRICULUM_LESSONS,
  CURRICULUM_LEVELS,
  TOTAL_LESSONS,
  getLesson,
} from "../../content";
import { progressRepo, statsRepo } from "../db/repositories";
import type { Lesson } from "../schemas";

/**
 * Overall progress tracking service (PRD §12; Phase 5 plan §3.1).
 *
 * Every number is a SQL aggregate over `lesson_progress` / `lesson_attempts`
 * (§25 — never a full-table scan into JS); only the curriculum ORDER (which
 * is bundled TS, not DB state) is applied in JS over thin id/status lists.
 *
 * Definitions (Phase 5 plan §2):
 * - lifetime WPM/accuracy = mean over COMPLETED attempts;
 * - recent = mean of the last 10 completed attempts (trend = recent − lifetime);
 * - overall % = completed lessons / 260 bundled lessons;
 * - "highest unlocked" = the furthest lesson in curriculum order whose
 *   progress row is not `locked`.
 */

export interface PerLevelProgress {
  level: number;
  name: string;
  tagline: string;
  completed: number;
  total: number;
  pct: number;
}

export interface OverallProgress {
  totalLessons: number;
  completedLessons: number;
  overallPct: number;
  perLevel: PerLevelProgress[];
  /** Completed attempts in the ledger. */
  totalAttempts: number;
  lifetimeWpm: number;
  lifetimeAccuracy: number;
  /** Mean of the last 10 completed attempts (0 when none exist). */
  recentWpm: number;
  recentAccuracy: number;
  /** recent − lifetime (the hero trend arrows). */
  wpmTrend: number;
  accuracyTrend: number;
  /** Correct + incorrect characters across completed attempts. */
  lifetimeKeys: number;
}

export interface CurriculumPosition {
  /** First `available` lesson in curriculum order — the §12 "Current Lesson". */
  currentLesson: Lesson | null;
  /** Lesson with the newest `completed_at` (§12 "last completed"). */
  lastCompletedLesson: Lesson | null;
  /** Furthest non-locked lesson in curriculum order. */
  highestUnlockedLesson: Lesson | null;
}

/** The §12 per-level breakdown (L1..L7 with completed/total counts). */
async function getPerLevelProgress(): Promise<PerLevelProgress[]> {
  const completedByLevel = await progressRepo.completedByLevel();
  return CURRICULUM_LEVELS.map((level) => {
    const completed = completedByLevel.get(level.level) ?? 0;
    const total = level.lessons.length;
    return {
      level: level.level,
      name: level.name,
      tagline: level.tagline,
      completed,
      total,
      pct: total > 0 ? (completed / total) * 100 : 0,
    };
  });
}

/** All §12 totals, computed by SQL aggregates over the fixture DB. */
export async function getOverallProgress(): Promise<OverallProgress> {
  const [completedLessons, perLevel, overview, recent] = await Promise.all([
    progressRepo.countByStatus("completed"),
    getPerLevelProgress(),
    statsRepo.overview(),
    statsRepo.recentMean(10),
  ]);

  return {
    totalLessons: TOTAL_LESSONS,
    completedLessons,
    overallPct:
      TOTAL_LESSONS > 0 ? (completedLessons / TOTAL_LESSONS) * 100 : 0,
    perLevel,
    totalAttempts: overview.attempts,
    lifetimeWpm: overview.avgWpm,
    lifetimeAccuracy: overview.avgAccuracy,
    recentWpm: recent?.wpm ?? 0,
    recentAccuracy: recent?.accuracy ?? 0,
    wpmTrend: (recent?.wpm ?? 0) - overview.avgWpm,
    accuracyTrend: (recent?.accuracy ?? 0) - overview.avgAccuracy,
    lifetimeKeys: overview.keysTyped,
  };
}

/** Curriculum position: current, last completed, highest unlocked (§12). */
export async function getPosition(): Promise<CurriculumPosition> {
  const [availableIds, completedIds, lastCompleted] = await Promise.all([
    progressRepo.lessonIdsByStatus("available"),
    progressRepo.lessonIdsByStatus("completed"),
    progressRepo.lastCompleted(),
  ]);

  const orderIndex = new Map(CURRICULUM_LESSONS.map((l, i) => [l.id, i]));
  const furthest = (ids: string[]): Lesson | null => {
    let best: Lesson | null = null;
    for (const id of ids) {
      const lesson = getLesson(id);
      if (lesson && (best === null || (orderIndex.get(lesson.id) ?? -1) > (orderIndex.get(best.id) ?? -1))) {
        best = lesson;
      }
    }
    return best;
  };

  const currentId = availableIds
    .map((id) => getLesson(id))
    .filter((l): l is Lesson => l !== undefined)
    .sort(
      (a, b) =>
        (orderIndex.get(a.id) ?? -1) - (orderIndex.get(b.id) ?? -1),
    )[0];

  return {
    currentLesson: currentId ?? null,
    lastCompletedLesson: lastCompleted ? getLesson(lastCompleted.lessonId) ?? null : null,
    // Furthest non-locked = available ∪ completed, resolved in JS because the
    // curriculum ORDER lives in the bundled content module, not the DB.
    highestUnlockedLesson: furthest([...availableIds, ...completedIds]),
  };
}

/** The lesson the Dashboard's resume card points at (§12 "continue from"). */
export async function continueFrom(): Promise<Lesson | null> {
  const position = await getPosition();
  return position.currentLesson;
}
