import { create } from "zustand";

import { CURRICULUM_LESSONS, getLesson, nextLessonInOrder } from "../content";
import { progressRepo } from "../lib/db/repositories";
import { seedCurriculum } from "../lib/curriculum/seed";
import type { LessonProgress } from "../lib/schemas";
import { useSessionStore } from "./useSessionStore";
import { useUiStore } from "./useUiStore";

/**
 * Curriculum store (Phase 4 plan §3.6) — a client-side VIEW over the DB
 * truth, never a duplication of it: `progress` rows are read from SQLite and
 * re-read after every attempt; lesson content comes from the bundled
 * curriculum (single source of truth for the generator output).
 */

interface CurriculumState {
  /** True once the first bootstrap finished (successfully or not). */
  loaded: boolean;
  /** Startup error (e.g. DB unavailable) — screens render graceful states. */
  dbError: string | null;
  /** lessonId -> progress row, exactly as stored in `lesson_progress`. */
  progress: Record<string, LessonProgress>;
  /** Runs once at app startup: seed, then read all progress rows. */
  bootstrap: () => Promise<void>;
  /** Re-reads progress rows after an attempt (or any DB change). */
  refresh: () => Promise<void>;
  /**
   * §26 entry point: Lessons screen "Start/Resume/Replay". Resets any
   * finished session, routes to the typing session; the session screen
   * actually starts the lesson once it mounts (single start path).
   */
  startLesson: (lessonId: string) => void;
}

function rowsToMap(rows: LessonProgress[]): Record<string, LessonProgress> {
  return Object.fromEntries(rows.map((row) => [row.lessonId, row]));
}

export const useCurriculumStore = create<CurriculumState>((set) => ({
  loaded: false,
  dbError: null,
  progress: {},

  bootstrap: async () => {
    try {
      await seedCurriculum();
      const rows = await progressRepo.all();
      set({ progress: rowsToMap(rows), dbError: null, loaded: true });
    } catch (error) {
      // DB unavailable (e.g. plugin missing outside Tauri): still render the
      // curriculum skeleton with a visible error, never a blank screen.
      const raw =
        error instanceof Error ? error.message : "Database unavailable";
      set({
        dbError: raw.includes("invoke")
          ? "SQLite bridge unreachable (plugin missing outside the Tauri runtime)"
          : raw,
        loaded: true,
      });
    }
  },

  refresh: async () => {
    try {
      const rows = await progressRepo.all();
      set({ progress: rowsToMap(rows), dbError: null });
    } catch (error) {
      set({
        dbError:
          error instanceof Error ? error.message : "Database unavailable",
      });
    }
  },
  startLesson: (lessonId) => {
    const lesson = getLesson(lessonId);
    if (!lesson) return;
    useSessionStore.getState().reset();
    useUiStore.getState().navigate("typing-session", {
      "typing-session": { lessonId },
    });
  },
}));

/** Status of one lesson, defaulting to locked when progress is missing. */
export function lessonStatus(
  progress: Record<string, LessonProgress>,
  lessonId: string,
): "locked" | "available" | "completed" {
  return progress[lessonId]?.status ?? "locked";
}

/** Convenience helper combining content + progress for the current frontier. */
export function currentLesson(
  progress: Record<string, LessonProgress>,
): { id: string; level: number; title: string } | null {
  const available = CURRICULUM_LESSONS.find(
    (lesson) => lessonStatus(progress, lesson.id) === "available",
  );
  return available
    ? { id: available.id, level: available.level, title: available.title }
    : null;
}

/** The lesson after a given one, resolved from the bundled curriculum. */
export function resolveNextLesson(lessonId: string) {
  return nextLessonInOrder(lessonId);
}

export { getLesson };
