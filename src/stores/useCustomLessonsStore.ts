import { create } from "zustand";

import { getLesson } from "../content";
import { attemptsRepo, customLessonsRepo } from "../lib/db/repositories";
import type { Lesson, CustomLesson } from "../lib/schemas";
import { customIdFromRef, customLessonRef, toCurriculumLesson } from "../lib/customLessons/domain";

/**
 * Custom-lessons store (§16, Phase 7) — the DB truth for user-authored
 * modules plus per-module PB markers read from the unified attempts ledger
 * (`kind='custom'`; custom lessons never write `lesson_progress`). The
 * authoring form state lives in the screen; this store owns persistence.
 */

/** §16 card markers for one module (0 attempts => not practiced yet). */
export interface CustomModuleStats {
  attempts: number;
  bestWpm: number;
  bestAccuracy: number;
}

interface CustomLessonsState {
  loaded: boolean;
  error: string | null;
  lessons: CustomLesson[];
  /** `custom-<id>` -> ledger stats (PB / attempt count on the cards). */
  stats: Record<string, CustomModuleStats>;

  load: () => Promise<void>;
  create: (lesson: CustomLesson) => Promise<void>;
  update: (id: string, patch: Partial<Omit<CustomLesson, "id" | "createdAt">>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useCustomLessonsStore = create<CustomLessonsState>((set) => ({
  loaded: false,
  error: null,
  lessons: [],
  stats: {},

  load: async () => {
    try {
      const lessons = await customLessonsRepo.all();
      const entries = await Promise.all(
        lessons.map(async (lesson) => {
          const ref = customLessonRef(lesson.id);
          return [ref, await attemptsRepo.customStats(ref)] as const;
        }),
      );
      set({
        lessons,
        stats: Object.fromEntries(entries),
        error: null,
        loaded: true,
      });
    } catch (error) {
      set({
        loaded: true,
        error: error instanceof Error ? error.message : "Custom modules unavailable",
      });
    }
  },

  create: async (lesson) => {
    await customLessonsRepo.insert(lesson);
    await useCustomLessonsStore.getState().load();
  },

  update: async (id, patch) => {
    await customLessonsRepo.update(id, patch);
    await useCustomLessonsStore.getState().load();
  },

  remove: async (id) => {
    await customLessonsRepo.remove(id);
    await useCustomLessonsStore.getState().load();
  },
}));

/**
 * Resolves a typing-session lesson id into a Lesson: curriculum ids hit the
 * bundled content; `custom-<uuid>` refs load the module from the DB and
 * derive its FK mirror row. Drafts are not practiceable (plan §3.1).
 */
export async function resolveTypingLesson(
  lessonId: string,
): Promise<Lesson | null> {
  const curriculum = getLesson(lessonId);
  if (curriculum != null) return curriculum;
  const customId = customIdFromRef(lessonId);
  if (customId === null) return null;
  const row = await customLessonsRepo.get(customId);
  if (row === null || row.isDraft) return null;
  return toCurriculumLesson(row);
}
