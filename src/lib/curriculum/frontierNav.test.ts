import { describe, expect, it } from "vitest";

import { CURRICULUM_LESSONS, lessonsByLevel } from "../../content";
import type { Lesson, LessonProgress, LessonStatus } from "../schemas";
import {
  SYMBOL_CHIPS,
  SYMBOL_CHIP_IDS,
  averageLevelStats,
  firstAvailableLessonInLevel,
  masteryBar,
  matchesAnySymbolChip,
  matchesSymbolChip,
  milestoneAckKey,
  nextMilestoneToCelebrate,
  pendingMilestoneLevels,
  summarizeLevel,
  type SymbolChipId,
} from "./frontierNav";

/**
 * Frontier-navigation unit tests (UX plan §6.1–§6.4): symbol-chip matching
 * against the REAL 260-lesson curriculum, the HUD mastery meter, level
 * summaries and the milestone acknowledgement decision.
 */

function get(id: string): Lesson {
  const lesson = CURRICULUM_LESSONS.find((entry) => entry.id === id);
  if (lesson === undefined) throw new Error(`unknown lesson ${id}`);
  return lesson;
}

function makeLesson(partial: Partial<Lesson> & { id: string }): Lesson {
  return {
    level: 7,
    orderIndex: 0,
    title: "Synthetic",
    description: "",
    content: "const x = 1;",
    targetKeys: [],
    tags: [],
    source: "builtin",
    createdAt: 0,
    ...partial,
  };
}

function row(lessonId: string, status: LessonStatus, attemptCount = 1): LessonProgress {
  return {
    lessonId,
    status,
    bestWpm: 60,
    bestAccuracy: 97,
    lowestErrorRate: 3,
    attemptCount,
    unlockedAt: 1,
    completedAt: status === "completed" ? 2 : null,
    updatedAt: 2,
  };
}

/** Progress map with every lesson of `level` completed (and optionally the
 *  next level's first lesson unlocked). */
function completeLevel(level: number): Record<string, LessonProgress> {
  const progress: Record<string, LessonProgress> = {};
  for (const lesson of lessonsByLevel(level)) {
    progress[lesson.id] = row(lesson.id, "completed");
  }
  return progress;
}

describe("SYMBOL_CHIPS (UX plan §6.3)", () => {
  it("lists the eight design chips in order", () => {
    expect(SYMBOL_CHIPS.map((chip) => chip.label)).toEqual([
      "{ Brackets }",
      "( Parens )",
      "[ Arrays ]",
      "< Generics >",
      "=> Arrows",
      "&& Operators",
      "async/await",
      "SQL",
    ]);
    expect(SYMBOL_CHIP_IDS).toHaveLength(8);
  });

  it("every chip matches at least one real curriculum lesson", () => {
    for (const chipId of SYMBOL_CHIP_IDS) {
      const matches = CURRICULUM_LESSONS.filter((lesson) =>
        matchesSymbolChip(lesson, chipId),
      );
      expect(matches.length, `chip ${chipId}`).toBeGreaterThan(0);
    }
  });
});

describe("matchesSymbolChip", () => {
  const cases: Array<[SymbolChipId, string, string]> = [
    ["braces", "l3-004", "l1-001"],
    ["parens", "l3-001", "l1-001"],
    ["arrays", "l3-007", "l1-001"],
    ["generics", "l3-010", "l1-001"],
    ["arrows", "l6-010", "l1-001"],
    ["operators", "l3-017", "l1-001"],
    ["async", "l6-021", "l1-001"],
    ["sql", "l7-014", "l1-001"],
  ];

  it.each(cases)("%s: positive %s, negative %s", (chipId, yes, no) => {
    expect(matchesSymbolChip(get(yes), chipId)).toBe(true);
    expect(matchesSymbolChip(get(no), chipId)).toBe(false);
  });

  it("matches literal symbols only when the content types them", () => {
    expect(matchesSymbolChip(makeLesson({ id: "a", content: "let x = {};" }), "braces")).toBe(true);
    expect(matchesSymbolChip(makeLesson({ id: "b", content: "let x = [1];" }), "braces")).toBe(false);
    expect(matchesSymbolChip(makeLesson({ id: "c", content: "fn(a, b)" }), "parens")).toBe(true);
    expect(matchesSymbolChip(makeLesson({ id: "d", content: "fn[a]" }), "parens")).toBe(false);
    expect(matchesSymbolChip(makeLesson({ id: "e", content: "arr[0]" }), "arrays")).toBe(true);
    expect(matchesSymbolChip(makeLesson({ id: "f", content: "arr(0)" }), "arrays")).toBe(false);
    expect(matchesSymbolChip(makeLesson({ id: "g", content: "Box<T>" }), "generics")).toBe(true);
    expect(matchesSymbolChip(makeLesson({ id: "h", content: "Box(T)" }), "generics")).toBe(false);
    expect(matchesSymbolChip(makeLesson({ id: "i", content: "x => x" }), "arrows")).toBe(true);
    expect(matchesSymbolChip(makeLesson({ id: "j", content: "x -> x" }), "arrows")).toBe(false);
    expect(matchesSymbolChip(makeLesson({ id: "k", content: "a && b" }), "operators")).toBe(true);
    expect(matchesSymbolChip(makeLesson({ id: "l", content: "a & b" }), "operators")).toBe(false);
  });

  it("falls back to tags for the operators / async / sql word chips", () => {
    expect(
      matchesSymbolChip(makeLesson({ id: "m", content: "1 + 1", tags: ["operators"] }), "operators"),
    ).toBe(true);
    expect(
      matchesSymbolChip(
        makeLesson({ id: "n", content: "fetch data", tags: ["async"] }),
        "async",
      ),
    ).toBe(true);
    expect(
      matchesSymbolChip(
        makeLesson({ id: "o", content: "select rows", tags: ["sql"] }),
        "sql",
      ),
    ).toBe(true);
    expect(
      matchesSymbolChip(makeLesson({ id: "p", content: "plain text", tags: ["home-row"] }), "sql"),
    ).toBe(false);
  });

  it("finds async/await and SQL through title/description keywords", () => {
    expect(
      matchesSymbolChip(
        makeLesson({ id: "q", content: "const x = 1;", title: "Await Promises" }),
        "async",
      ),
    ).toBe(true);
    expect(
      matchesSymbolChip(
        makeLesson({ id: "r", content: "SELECT id FROM users;" }),
        "sql",
      ),
    ).toBe(true);
    expect(
      matchesSymbolChip(
        makeLesson({ id: "s", content: "Please select a row from the list", tags: [] }),
        "sql",
      ),
    ).toBe(false);
  });

  it("returns false for an unknown chip id", () => {
    expect(matchesSymbolChip(get("l1-001"), "nope" as SymbolChipId)).toBe(false);
  });
});

describe("matchesAnySymbolChip", () => {
  const braces = get("l3-004");
  const sql = get("l7-014");

  it("matches everything when no chip is selected", () => {
    expect(matchesAnySymbolChip(get("l1-001"), new Set())).toBe(true);
  });

  it("unions the selected chips (multi-select widens the slice)", () => {
    expect(matchesAnySymbolChip(braces, new Set(["braces"]))).toBe(true);
    expect(matchesAnySymbolChip(sql, new Set(["braces"]))).toBe(false);
    expect(matchesAnySymbolChip(sql, new Set(["braces", "sql"]))).toBe(true);
    expect(matchesAnySymbolChip(braces, new Set(["sql"]))).toBe(false);
  });

  it("filters the whole curriculum for every chip set", () => {
    for (const chipId of SYMBOL_CHIP_IDS) {
      const subset = CURRICULUM_LESSONS.filter((lesson) =>
        matchesAnySymbolChip(lesson, new Set([chipId])),
      );
      expect(subset.length, `chip ${chipId}`).toBeGreaterThan(0);
    }
  });
});

describe("masteryBar (UX plan §6.1)", () => {
  it("renders a frontier cursor while in progress", () => {
    expect(masteryBar(38, 50, 10)).toBe("[========>-]");
    expect(masteryBar(0, 50, 10)).toBe("[>---------]");
    expect(masteryBar(5, 50, 10)).toBe("[=>--------]");
  });

  it("drops the cursor at 100%", () => {
    expect(masteryBar(50, 50, 10)).toBe("[==========]");
    expect(masteryBar(4, 4, 4)).toBe("[====]");
  });

  it("clamps out-of-range input", () => {
    expect(masteryBar(-3, 50, 10)).toBe("[>---------]");
    expect(masteryBar(99, 50, 10)).toBe("[==========]");
    expect(masteryBar(1, 0, 10)).toBe("[]");
    expect(masteryBar(1, 5, 0)).toBe("[]");
  });
});

describe("summarizeLevel (UX plan §6.2)", () => {
  it("summarizes a half-finished level from progress rows", () => {
    const lessons = lessonsByLevel(3);
    const progress: Record<string, LessonProgress> = {};
    for (const lesson of lessons.slice(0, 19)) {
      progress[lesson.id] = row(lesson.id, "completed");
    }
    const mastery = summarizeLevel(3, progress);
    expect(mastery.total).toBe(lessons.length);
    expect(mastery.completed).toBe(19);
    expect(mastery.complete).toBe(false);
    expect(mastery.tier).toBe("SYMBOLS");
    expect(mastery.name).toBe("Programming Symbols, Delimiters & Pointers");
    expect(mastery.pct).toBe(Math.round((19 / lessons.length) * 100));
  });

  it("marks a fully completed level as complete", () => {
    const mastery = summarizeLevel(7, completeLevel(7));
    expect(mastery.complete).toBe(true);
    expect(mastery.pct).toBe(100);
    expect(mastery.tier).toBe("APEX");
  });

  it("reports an untouched level as 0%", () => {
    const mastery = summarizeLevel(1, {});
    expect(mastery.completed).toBe(0);
    expect(mastery.pct).toBe(0);
    expect(mastery.complete).toBe(false);
  });
});

describe("averageLevelStats / firstAvailableLessonInLevel", () => {
  it("averages only attempted lessons", () => {
    const lessons = lessonsByLevel(1);
    const progress: Record<string, LessonProgress> = {
      [lessons[0].id]: row(lessons[0].id, "completed"),
      [lessons[1].id]: { ...row(lessons[1].id, "available"), bestWpm: 80, bestAccuracy: 99 },
    };
    const stats = averageLevelStats(1, progress);
    expect(stats).not.toBeNull();
    expect(stats?.wpm).toBe(70);
    expect(stats?.accuracy).toBe(98);
  });

  it("returns null when nothing was attempted", () => {
    expect(averageLevelStats(1, {})).toBeNull();
  });

  it("finds the first available lesson of a level", () => {
    const lessons = lessonsByLevel(3);
    const progress: Record<string, LessonProgress> = {
      [lessons[0].id]: row(lessons[0].id, "completed"),
      [lessons[1].id]: row(lessons[1].id, "available"),
      [lessons[2].id]: row(lessons[2].id, "available"),
    };
    expect(firstAvailableLessonInLevel(3, progress)?.id).toBe(lessons[1].id);
    expect(firstAvailableLessonInLevel(3, completeLevel(3))).toBeNull();
  });
});

describe("milestone acknowledgement (UX plan §6.4)", () => {
  it("uses the per-level localStorage key", () => {
    expect(milestoneAckKey(3)).toBe("typekernel.milestone.L3");
    expect(milestoneAckKey(7)).toBe("typekernel.milestone.L7");
  });

  it("collects completed-but-unacknowledged levels in ascending order", () => {
    const progress = { ...completeLevel(1), ...completeLevel(2) };
    expect(pendingMilestoneLevels(new Set(), progress)).toEqual([1, 2]);
    expect(pendingMilestoneLevels(new Set([milestoneAckKey(1)]), progress)).toEqual([2]);
    expect(
      pendingMilestoneLevels(new Set([milestoneAckKey(1), milestoneAckKey(2)]), progress),
    ).toEqual([]);
  });

  it("never celebrates a partially completed level", () => {
    const partial = completeLevel(1);
    const lessons = lessonsByLevel(1);
    delete partial[lessons[lessons.length - 1].id];
    expect(pendingMilestoneLevels(new Set(), partial)).toEqual([]);
    expect(nextMilestoneToCelebrate(new Set(), partial)).toBeNull();
  });

  it("celebrates the most recent (highest) pending completion", () => {
    const progress = { ...completeLevel(1), ...completeLevel(2), ...completeLevel(3) };
    expect(nextMilestoneToCelebrate(new Set(), progress)).toBe(3);
    expect(nextMilestoneToCelebrate(new Set([milestoneAckKey(3)]), progress)).toBe(2);
    expect(nextMilestoneToCelebrate(new Set(), {})).toBeNull();
  });
});
