import { describe, expect, it } from "vitest";

import { LessonSchema } from "../lib/schemas";
import {
  CURRICULUM_LESSONS,
  CURRICULUM_LEVELS,
  FIRST_LESSON_ID,
  LEVEL_COUNTS,
  TOTAL_LESSONS,
  getLesson,
  nextLessonInOrder,
} from "./index";
import { MAX_CONTENT_CHARS, MIN_CONTENT_CHARS } from "./types";

/**
 * Curriculum validation suite (PRD §2, §6.1; Phase 4 plan §3.3).
 * A failing test here blocks the phase: content quality is contractual.
 */

describe("curriculum shape (PRD §2)", () => {
  it("has exactly the planned per-level counts (26/35/50/48/42/37/22 = 260)", () => {
    expect(CURRICULUM_LEVELS.map((l) => l.lessons.length)).toEqual([
      ...LEVEL_COUNTS,
    ]);
    expect(TOTAL_LESSONS).toBe(260);
    expect(TOTAL_LESSONS).toBeGreaterThanOrEqual(250);
  });

  it("uses unique lesson ids following the l{level}-{3-digit} scheme", () => {
    const ids = CURRICULUM_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^l[1-7]-\d{3}$/);
  });

  it("numbers ids 1-based and keeps order_index monotonic per level", () => {
    for (const level of CURRICULUM_LEVELS) {
      level.lessons.forEach((lesson, i) => {
        expect(lesson.id).toBe(`l${level.level}-${String(i + 1).padStart(3, "0")}`);
        expect(lesson.orderIndex).toBe(i);
      });
    }
  });

  it("starts with l1-001 (the first-available lesson)", () => {
    expect(FIRST_LESSON_ID).toBe("l1-001");
    expect(CURRICULUM_LESSONS[0].id).toBe("l1-001");
  });

  it("validates every lesson against LessonSchema (Zod, PRD §23)", () => {
    for (const lesson of CURRICULUM_LESSONS) {
      const result = LessonSchema.safeParse(lesson);
      if (!result.success) {
        throw new Error(`${lesson.id}: ${result.error.message}`);
      }
    }
  });

  it("keeps content within the 150-600 char session budget, no tabs", () => {
    const violations: string[] = [];
    for (const lesson of CURRICULUM_LESSONS) {
      if (lesson.content.includes("\t")) violations.push(`${lesson.id}: tab`);
      if (lesson.content.length < MIN_CONTENT_CHARS) {
        violations.push(`${lesson.id}: ${lesson.content.length} < ${MIN_CONTENT_CHARS}`);
      }
      if (lesson.content.length > MAX_CONTENT_CHARS) {
        violations.push(`${lesson.id}: ${lesson.content.length} > ${MAX_CONTENT_CHARS}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("gives every lesson a title, description and at least one target key", () => {
    for (const lesson of CURRICULUM_LESSONS) {
      expect(lesson.title.length).toBeGreaterThan(0);
      expect(lesson.description.length).toBeGreaterThan(0);
      expect(lesson.targetKeys.length).toBeGreaterThan(0);
    }
  });
});

describe("§6.1 symbol coverage", () => {
  const REQUIRED = [
    "(", ")", "{", "}", "[", "]", "<", ">", "/", "\\", "|", "&", "*",
    "=", "+", "-", "_", ":", ";", "'", '"', "`", "!", "?", "@", "#", "$",
  ];
  const DIGITS = "0123456789".split("");
  const CAPITALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const MIN_LESSONS_PER_KEY = 3;

  function lessonsWith(key: string): number {
    return CURRICULUM_LESSONS.filter((l) => l.targetKeys.includes(key)).length;
  }

  it("covers every §6.1 symbol in at least 3 lessons' target_keys", () => {
    const missing = REQUIRED.map((key) => ({ key, count: lessonsWith(key) }))
      .filter((entry) => entry.count < MIN_LESSONS_PER_KEY);
    expect(missing).toEqual([]);
  });

  it("covers every digit 0-9 in at least 3 lessons' target_keys", () => {
    const missing = DIGITS.map((key) => ({ key, count: lessonsWith(key) }))
      .filter((entry) => entry.count < MIN_LESSONS_PER_KEY);
    expect(missing).toEqual([]);
  });

  it("covers every capital A-Z in at least 3 lessons' target_keys", () => {
    const missing = CAPITALS.map((key) => ({ key, count: lessonsWith(key) }))
      .filter((entry) => entry.count < MIN_LESSONS_PER_KEY);
    expect(missing).toEqual([]);
  });
});

describe("level 7 language tags (PRD §6)", () => {
  const PRD_LANGUAGES = [
    "javascript", "typescript", "html", "css", "sql", "json", "bash", "git",
  ];

  it("tags every L7 lesson with one of the 8 PRD languages", () => {
    const l7 = CURRICULUM_LESSONS.filter((l) => l.level === 7);
    expect(l7.length).toBe(22);
    for (const lesson of l7) {
      const language = lesson.tags.find((t) => PRD_LANGUAGES.includes(t));
      expect(language, `${lesson.id} missing language tag`).toBeDefined();
    }
  });

  it("spreads L7 across all 8 languages", () => {
    const l7 = CURRICULUM_LESSONS.filter((l) => l.level === 7);
    for (const language of PRD_LANGUAGES) {
      expect(
        l7.some((l) => l.tags.includes(language)),
        `no lesson tagged ${language}`,
      ).toBe(true);
    }
  });
});

describe("curriculum lookups", () => {
  it("resolves lessons by id", () => {
    expect(getLesson("l1-001")?.title.length).toBeGreaterThan(0);
    expect(getLesson("l7-022")).toBeDefined();
    expect(getLesson("nope")).toBeUndefined();
  });

  it("walks curriculum order with nextLessonInOrder", () => {
    expect(nextLessonInOrder("l1-001")?.id).toBe("l1-002");
    expect(nextLessonInOrder("l1-026")?.id).toBe("l2-001");
    expect(nextLessonInOrder("l6-037")?.id).toBe("l7-001");
    expect(nextLessonInOrder("l7-022")).toBeNull();
    expect(nextLessonInOrder("ghost")).toBeNull();
  });
});
