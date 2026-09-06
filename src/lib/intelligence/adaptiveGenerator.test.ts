import { describe, expect, it } from "vitest";

import { LessonSchema, type DrillConfig } from "../schemas";
import {
  CORPUS_WORDS,
  DISTRACTOR_SYMBOLS,
  TEMPLATE_WORDS,
  generateDrillSet,
  generateDrillSets,
  hashSeed,
  mulberry32,
} from "./adaptiveGenerator";
import type { WeaknessAnalysis } from "./analyzer";

/**
 * Adaptive generator property tests (Phase 6 plan §5.1): output passes the
 * LessonSchema, is deterministic per (analysis, seed, setIndex), is never
 * empty, and over-samples weak chars at ~ the configured weight (×3).
 */

const CONFIG: Pick<DrillConfig, "symbolWeight" | "setLength" | "wordContext"> = {
  symbolWeight: 3,
  setLength: 120,
  wordContext: "code_identifiers",
};

/** Analysis with `{`, `:`, `]` weak (targeted) and `;` in maintenance. */
function fakeAnalysis(): WeaknessAnalysis {
  return {
    targets: [
      { key: "{", shiftRequired: false, accuracy: 78, presses: 100, misses: 22, state: "targeted", priority: 1, stateSince: "2026-09-01" },
      { key: ":", shiftRequired: true, accuracy: 81, presses: 90, misses: 17, state: "targeted", priority: 2, stateSince: "2026-09-01" },
      { key: "]", shiftRequired: false, accuracy: 88, presses: 80, misses: 10, state: "targeted", priority: 3, stateSince: "2026-09-01" },
      { key: ";", shiftRequired: false, accuracy: 91, presses: 70, misses: 6, state: "maintenance", priority: null, stateSince: "2026-08-20" },
    ],
    combos: [
      { pair: "->", errorRate: 30, total: 40 },
      { pair: "::", errorRate: 12, total: 50 },
    ],
    patterns: [],
    slowest: [],
    empty: false,
  };
}

const input = (overrides: Partial<Parameters<typeof generateDrillSet>[0]> = {}) => ({
  analysis: fakeAnalysis(),
  config: CONFIG,
  seed: 1234,
  setIndex: 0,
  userLevel: 4,
  ...overrides,
});

describe("generateDrillSet", () => {
  it("produces schema-valid, non-empty lesson-shaped output", () => {
    const { lesson } = generateDrillSet(input());
    // LessonSchema.parse throws on any invalid shape.
    expect(lesson.content.length).toBeGreaterThanOrEqual(1);
    expect(lesson.content).not.toContain("\t");
    // Template markers must never leak into content (compound parts like
    // "{I}_" are tokenized).
    for (const marker of ["{I}", "{N}", "{W}", "{B}"]) {
      expect(lesson.content).not.toContain(marker);
    }
    expect(lesson.targetKeys).toEqual(["{", ":", "]", ";"]);
    expect(lesson.tags).toContain("adaptive");
    expect(LessonSchema.safeParse(lesson).success).toBe(true);
  });

  it("is deterministic per (analysis, seed, setIndex) and varies per seed", () => {
    const a = generateDrillSet(input({ seed: 42, setIndex: 2 }));
    const b = generateDrillSet(input({ seed: 42, setIndex: 2 }));
    const c = generateDrillSet(input({ seed: 43, setIndex: 2 }));
    expect(a.lesson.content).toBe(b.lesson.content);
    expect(a.lesson.content).not.toBe(c.lesson.content);
    expect(a.lesson.id).toBe(`adaptive-${(42).toString(36)}-2`);
  });

  it("respects the set length target (~120 keystrokes)", () => {
    for (let setIndex = 0; setIndex < 5; setIndex++) {
      const { lesson } = generateDrillSet(input({ setIndex }));
      expect(lesson.content.length).toBe(120);
    }
  });

  it("over-samples weak chars at ~ the configured weight (×3 vs distractors)", () => {
    // Focus chars chosen to be absent from template literals and the
    // distractor set, so counts measure only {S}/{B} slot output.
    const focus = ["{", "%", "#", "!"];
    const analysis = fakeAnalysis();
    analysis.targets = focus.map((key, i) => ({
      key,
      shiftRequired: i % 2 === 1,
      accuracy: 78 + i,
      presses: 100,
      misses: 22,
      state: "targeted" as const,
      priority: i + 1,
      stateSince: "2026-09-01",
    }));
    const ratioFor = (weight: number) => {
      let text = "";
      for (let seed = 0; seed < 40; seed++) {
        text += generateDrillSet(
          input({ analysis, seed, setIndex: 1, config: { ...CONFIG, symbolWeight: weight } }),
        ).lesson.content;
      }
      const count = (char: string) => text.split(char).length - 1;
      const focusMean = focus.reduce((sum, c) => sum + count(c), 0) / focus.length;
      const distractorMean =
        DISTRACTOR_SYMBOLS.reduce((sum, s) => sum + count(s), 0) /
        DISTRACTOR_SYMBOLS.length;
      return focusMean / distractorMean;
    };

    const ratio3 = ratioFor(3);
    // ×3 weight + the coverage fallback push the ratio modestly above 3.
    expect(ratio3).toBeGreaterThan(2.8);
    expect(ratio3).toBeLessThan(5.5);
    // Lower weight must collapse toward 1 — monotonic in the config.
    const ratio1 = ratioFor(1);
    expect(ratio1).toBeLessThan(ratio3);
    expect(ratio1).toBeGreaterThan(1);
  });

  it("guarantees every line trains at least one focus symbol", () => {
    for (let seed = 0; seed < 30; seed++) {
      const { lesson, weakChars } = generateDrillSet(input({ seed }));
      expect(weakChars.length).toBeGreaterThan(0);
      for (const line of lesson.content.split("\n")) {
        if (line.length === 0) continue; // bare trailing newline (set edge)
        const hasFocus = weakChars.some((c) => line.includes(c));
        expect(hasFocus, `line without focus symbol: ${JSON.stringify(line)}`).toBe(true);
      }
    }
  });

  it("composes contexts from real corpus identifiers (no letter soup)", () => {
    const words = new Set<string>([...CORPUS_WORDS, ...TEMPLATE_WORDS]);
    // A trim at a line boundary may sever a word mid-run; a letter run is
    // acceptable when it is a corpus word or a PREFIX of one — random
    // letter soup is neither.
    const allowed = (run: string) =>
      words.has(run) ||
      CORPUS_WORDS.some((w) => w.startsWith(run)) ||
      TEMPLATE_WORDS.some((w) => w.startsWith(run));
    for (let seed = 0; seed < 30; seed++) {
      const { lesson } = generateDrillSet(input({ seed }));
      const runs = lesson.content.match(/[a-z]{2,}/g) ?? [];
      for (const run of runs) {
        expect(
          allowed(run),
          `non-corpus letter run "${run}" in seed ${seed}`,
        ).toBe(true);
      }
    }
  });

  it("embeds a weak bigram from the analyzer in context", () => {
    // The bigram slot is probabilistic per set; across seeds it must appear.
    const candidates = ["->", "::", "{:", ":]", "]{", "{]", "}_", "{_"];
    let seen = false;
    for (let seed = 0; seed < 12 && !seen; seed++) {
      const { lesson } = generateDrillSet(input({ seed }));
      seen = candidates.some((pair) => lesson.content.includes(pair));
    }
    expect(seen).toBe(true);
  });

  it("titles the drill from target families", () => {
    const { lesson } = generateDrillSet(input({ seed: 9 }));
    expect(lesson.title).toContain("Brace");
    expect(lesson.title).toContain("Colon");
    expect(lesson.title).toContain("Bracket");
  });

  it("falls back to Free Practice when there are no weak chars", () => {
    const empty = generateDrillSet(
      input({ analysis: { targets: [], combos: [], patterns: [], slowest: [], empty: true } }),
    );
    expect(empty.lesson.title).toBe("Free Practice");
    expect(empty.lesson.content.length).toBe(120);
  });

  it("filters corpus templates by the user's curriculum level", () => {
    // Level 1 templates carry no `{`/`[`-style markers, so a level-1 drill
    // must still be valid but its weak chars arrive only via injection —
    // verify level clamping and validity at the extremes.
    expect(LessonSchema.safeParse(generateDrillSet(input({ userLevel: 1 })).lesson).success).toBe(true);
    expect(LessonSchema.safeParse(generateDrillSet(input({ userLevel: 99 })).lesson).success).toBe(true);
  });
});

describe("generateDrillSets", () => {
  it("builds one distinct set per index with unique ids", () => {
    const sets = generateDrillSets(input(), 5);
    expect(sets).toHaveLength(5);
    expect(new Set(sets.map((s) => s.lesson.id)).size).toBe(5);
    expect(new Set(sets.map((s) => s.lesson.content)).size).toBe(5);
  });
});

describe("rng helpers", () => {
  it("mulberry32 is deterministic; hashSeed is order-sensitive", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(hashSeed("a", "b")).not.toBe(hashSeed("b", "a"));
    expect(hashSeed(1, 2)).toBe(hashSeed(1, 2));
  });
});
