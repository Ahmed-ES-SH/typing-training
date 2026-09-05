import type { Lesson } from "../lib/schemas";

import { buildLevel1, LEVEL_1_META } from "./levels/level1";
import { buildLevel2, LEVEL_2_META } from "./levels/level2";
import { buildLevel3, LEVEL_3_META } from "./levels/level3";
import { buildLevel4, LEVEL_4_META } from "./levels/level4";
import { buildLevel5, LEVEL_5_META } from "./levels/level5";
import { buildLevel6, LEVEL_6_META } from "./levels/level6";
import { buildLevel7, LEVEL_7_META } from "./levels/level7";
import type { LevelMeta } from "./types";

/**
 * Curriculum assembly (PRD §2, §6 — 260 lessons across 7 levels).
 *
 * Every level generator runs at module load; all 260 lessons were validated
 * against `LessonSchema` inside `assemble()` — invalid content throws at
 * import time, so a bad generator can never ship silently.
 */

export interface CurriculumLevel extends LevelMeta {
  lessons: Lesson[];
}

/** Ordered levels — L1 lessons first, within each level by orderIndex. */
export const CURRICULUM_LEVELS: CurriculumLevel[] = [
  { ...LEVEL_1_META, lessons: buildLevel1() },
  { ...LEVEL_2_META, lessons: buildLevel2() },
  { ...LEVEL_3_META, lessons: buildLevel3() },
  { ...LEVEL_4_META, lessons: buildLevel4() },
  { ...LEVEL_5_META, lessons: buildLevel5() },
  { ...LEVEL_6_META, lessons: buildLevel6() },
  { ...LEVEL_7_META, lessons: buildLevel7() },
];

/** Every lesson in curriculum order (the seed & unlock order). */
export const CURRICULUM_LESSONS: Lesson[] = CURRICULUM_LEVELS.flatMap(
  (level) => level.lessons,
);

export const TOTAL_LESSONS = CURRICULUM_LESSONS.length;

/** The expected per-level counts (Phase 4 plan §2). */
export const LEVEL_COUNTS = [26, 35, 50, 48, 42, 37, 22] as const;

export const FIRST_LESSON_ID = CURRICULUM_LESSONS[0]?.id ?? "l1-001";

const LESSON_INDEX = new Map(CURRICULUM_LESSONS.map((l) => [l.id, l]));

export function getLesson(id: string): Lesson | undefined {
  return LESSON_INDEX.get(id);
}

export function lessonsByLevel(level: number): Lesson[] {
  return CURRICULUM_LEVELS.find((l) => l.level === level)?.lessons ?? [];
}

export function getLevelMeta(level: number): LevelMeta | undefined {
  return CURRICULUM_LEVELS.find((l) => l.level === level);
}

/**
 * The lesson that follows `id` in curriculum order (null when `id` is the
 * final lesson or unknown). Unlocking walks this order — never numeric ids.
 */
export function nextLessonInOrder(id: string): Lesson | null {
  const index = CURRICULUM_LESSONS.findIndex((l) => l.id === id);
  if (index === -1 || index === CURRICULUM_LESSONS.length - 1) return null;
  return CURRICULUM_LESSONS[index + 1];
}
