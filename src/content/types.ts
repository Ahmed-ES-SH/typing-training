import type { Lesson } from "../lib/schemas";

/**
 * Curriculum content pipeline types (Phase 4).
 *
 * Generators are plain TS modules under `src/content/levels/` that export
 * `Lesson[]` arrays built with the deterministic helpers in `build.ts` —
 * no RNG, no build step, stable across builds (MAIN_PLAN Phase 4 decision).
 * Output is validated against `LessonSchema` at assembly time and again by
 * the curriculum test-suite.
 */

/** The full, validated lesson record (mirrors `LessonSchema`). */
export type { Lesson };

/** Raw, pre-assembly lesson definition written by a level generator. */
export interface LessonSpec {
  title: string;
  description: string;
  /** Real practice content; `\n` separated lines, no tabs. */
  content: string;
  /**
   * Keys this lesson trains. Defaults to the unique characters of `content`
   * (spec keys first) — accurate by construction for drill lessons.
   */
  targetKeys?: string[];
  tags?: string[];
}

/** Static metadata for one curriculum level (drives the Lessons screen). */
export interface LevelMeta {
  level: number;
  /** e.g. "Home Row & Core Alphanumerics". */
  name: string;
  /** e.g. "FOUNDATION" — the design's uppercase track label. */
  tagline: string;
}

/** Session-length budget: roughly 30–90 s of typing at gate speeds. */
export const MIN_CONTENT_CHARS = 150;
export const MAX_CONTENT_CHARS = 600;
