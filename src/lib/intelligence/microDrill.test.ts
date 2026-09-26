import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import { LessonSchema } from "../schemas";
import { DEFAULT_DRILL_CONFIG } from "./drillService";
import { useSessionStore } from "../../stores/useSessionStore";
import {
  MICRO_DRILL_SET_LENGTH,
  MICRO_MAX_LINE_LENGTH,
  MIN_FOCUS_OCCURRENCES,
  PRINTABLE_CODE_TEXT,
  buildMicroDrillPlan,
  clearMicroDrillReturn,
  eliminationMessage,
  readMicroDrillReturn,
  stashMicroDrillReturn,
  type HintStorage,
} from "./microDrill";

/**
 * Micro-drill property tests (UX plan §7.1/§7.2): the plan is schema-valid
 * and deterministic, every missed key clears the coverage floor (including
 * the whitespace/newline edge cases), content stays inside the printable
 * code charset on short lines, and the elimination line formats the
 * design's "Accuracy 78% → 96%" progression. The last block runs the plan
 * through the session store to assert the §4.4 gates: `D` reaches the
 * pipeline immediately, and weakness metrics never touch curriculum unlocks.
 */

const MISSED = ["{", ":", "]"];

const planFor = (keys = MISSED, seed = 7, level = 3) => buildMicroDrillPlan(keys, seed, level);

describe("buildMicroDrillPlan (§7.1)", () => {
  it("builds ONE ~45s set with sane config and focus keys", () => {
    const plan = planFor();
    expect(plan.sets).toHaveLength(1);
    expect(plan.focusKeys).toEqual(MISSED);
    expect(plan.weakChars).toEqual([MISSED]);
    // 45 s arithmetic: 150 chars/min × 45/60 → 112 keys, inside 110-150.
    expect(MICRO_DRILL_SET_LENGTH).toBeGreaterThanOrEqual(110);
    expect(MICRO_DRILL_SET_LENGTH).toBeLessThanOrEqual(150);
    expect(plan.config.setLength).toBe(MICRO_DRILL_SET_LENGTH);
    expect(plan.config.sets).toBe(1);
    expect(plan.config.symbolWeight).toBe(DEFAULT_DRILL_CONFIG.symbolWeight);
    expect(plan.config.wordContext).toBe(DEFAULT_DRILL_CONFIG.wordContext);
    // LessonSchema.parse throws on any invalid shape (no tabs, non-empty).
    expect(LessonSchema.safeParse(plan.sets[0]).success).toBe(true);
    expect(plan.sets[0].content).not.toContain("\t");
    expect(plan.sets[0].content.length).toBeGreaterThanOrEqual(MICRO_DRILL_SET_LENGTH);
    expect(plan.sets[0].content.length).toBeLessThanOrEqual(MICRO_DRILL_SET_LENGTH + 40);
    expect(plan.sets[0].level).toBe(3);
  });

  it("dedupes the missed keys and caps them at 5", () => {
    const plan = buildMicroDrillPlan(
      [":", ":", "{", " ", "\n", "[", "]", "(", "+", '"'],
      1,
      2,
    );
    expect(plan.focusKeys).toHaveLength(5);
    expect(new Set(plan.focusKeys).size).toBe(plan.focusKeys.length);
    expect(plan.focusKeys[0]).toBe(":");
    expect(plan.focusKeys).toContain("\n");
  });

  it("is deterministic per (missed keys, seed) and varies per seed", () => {
    const a = planFor(MISSED, 42);
    const b = planFor(MISSED, 42);
    const c = planFor(MISSED, 43);
    expect(a.sets[0].content).toBe(b.sets[0].content);
    expect(a.seed).toBe(42);
    // id = `micro-<seed36>-<focus digest>` (digest = code points, base36):
    // "{" = 0x7b → "3f", ":" = 0x3a → "1m", "]" = 0x5d → "2l".
    expect(a.sets[0].id).toBe("micro-16-3f.1m.2l");
    expect(a.sets[0].id).toBe(b.sets[0].id);
    expect(c.sets[0].content).not.toBe(a.sets[0].content);
  });

  it("folds the focus keys into the id so same-seed plans never collide", () => {
    // The Weakness return-hint compares plan ids: `{`+`:` and `{`+`;` with
    // the same seed must be distinguishable, and an empty focus set too.
    const sameSeed = (keys: string[]) => buildMicroDrillPlan(keys, 7, 3).sets[0].id;
    const ids = [sameSeed(["{", ":"]), sameSeed(["{", ";"]), sameSeed(["{"]), sameSeed([])];
    expect(new Set(ids).size).toBe(ids.length);
    expect(sameSeed(["{", ":"])).toBe(sameSeed(["{", ":"]));
  });

  it("covers every missed key ≥ MIN_FOCUS_OCCURRENCES times", () => {
    const tricky = ["{", ":", "]", "\\", "%"];
    const plan = buildMicroDrillPlan(tricky, 11, 4);
    expect(plan.focusKeys).toEqual(tricky); // 5 keys = the focus cap
    for (const key of tricky) {
      const count = plan.sets[0].content.split(key).length - 1;
      expect(count, `coverage of ${JSON.stringify(key)}`).toBeGreaterThanOrEqual(
        MIN_FOCUS_OCCURRENCES,
      );
    }
    expect(plan.sets[0].targetKeys).toEqual(tricky);
  });

  it("handles the tricky whitespace keys (space, newline, quotes, backslash)", () => {
    const tricky = [" ", "\n", '"', "'", "\\"];
    const plan = buildMicroDrillPlan(tricky, 5, 4);
    const content = plan.sets[0].content;
    for (const key of tricky) {
      const count = content.split(key).length - 1;
      expect(count, `coverage of ${JSON.stringify(key)}`).toBeGreaterThanOrEqual(
        MIN_FOCUS_OCCURRENCES,
      );
    }
    // Charset + tab contract (LessonSchema also rejects tabs).
    expect(PRINTABLE_CODE_TEXT.test(content)).toBe(true);
    expect(content).not.toContain("\t");
    expect(LessonSchema.safeParse(plan.sets[0]).success).toBe(true);
  });

  it("stays inside the printable code charset on reasonably short lines", () => {
    const plan = buildMicroDrillPlan(["{", ":", "]", "f", "\\"], 99, 5);
    const content = plan.sets[0].content;
    expect(PRINTABLE_CODE_TEXT.test(content)).toBe(true);
    for (const line of content.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(MICRO_MAX_LINE_LENGTH);
    }
    // ~3 lines for the 112-key set (one more only when Enter is drilled).
    expect(content.split("\n").length).toBeLessThanOrEqual(4);
  });

  it("holds every size/coverage contract across a key-set × seed sweep", () => {
    // Regression net for `ensureCoverage`: it must APPEND only — an early
    // version replaced the last line outright, destroying placed content
    // and other keys' counts. 7 focus-key sets × 150 seeds covers the
    // punctuation/whitespace/letter shapes the Results screen can hand over.
    const keySets: readonly (readonly string[])[] = [
      MISSED, // 3 punctuation keys
      ["{", ":", "]", "\\", "%"], // 5 keys = the focus cap
      [" ", "\n", '"', "'", "\\"], // whitespace + quotes
      ["\n"], // Enter alone: line joins carry the coverage
      ["a", "e", "i", "o", "u"], // plain letters
      ["/", "*", "+", "-", "="], // operator pile
      ["d", "g", "h"], // common weak letters
    ];
    for (const keys of keySets) {
      for (let seed = 0; seed < 150; seed++) {
        const plan = buildMicroDrillPlan(keys, seed, 3);
        const content = plan.sets[0].content;
        const label = `${JSON.stringify(keys)} seed=${seed}`;
        // Size contract: never shorter than the set length, never past the
        // +40 coverage slack the plan promises.
        expect(content.length, label).toBeGreaterThanOrEqual(MICRO_DRILL_SET_LENGTH);
        expect(content.length, label).toBeLessThanOrEqual(MICRO_DRILL_SET_LENGTH + 40);
        const lines = content.split("\n");
        expect(lines.length, label).toBeLessThanOrEqual(4);
        for (const line of lines) {
          expect(line.length, `${label} line=${line}`).toBeLessThanOrEqual(
            MICRO_MAX_LINE_LENGTH,
          );
        }
        // Coverage floor for every focus key (the block's whole purpose).
        for (const key of plan.focusKeys) {
          const count = content.split(key).length - 1;
          expect(count, `${label} key=${JSON.stringify(key)}`).toBeGreaterThanOrEqual(
            MIN_FOCUS_OCCURRENCES,
          );
        }
        expect(LessonSchema.safeParse(plan.sets[0]).success, label).toBe(true);
      }
    }
  });

  it("produces a valid plan even with no missed keys", () => {
    const plan = buildMicroDrillPlan([], 3, 1);
    expect(plan.focusKeys).toEqual([]);
    expect(plan.sets).toHaveLength(1);
    expect(plan.sets[0].content.length).toBeGreaterThanOrEqual(MICRO_DRILL_SET_LENGTH);
    expect(PRINTABLE_CODE_TEXT.test(plan.sets[0].content)).toBe(true);
    expect(plan.sets[0].title).toContain("Free Practice");
    expect(LessonSchema.safeParse(plan.sets[0]).success).toBe(true);
  });

  it("clamps the user level into the 1-7 curriculum range", () => {
    expect(buildMicroDrillPlan(MISSED, 1, 0).sets[0].level).toBe(1);
    expect(buildMicroDrillPlan(MISSED, 1, 99).sets[0].level).toBe(7);
  });
});

describe("eliminationMessage (§7.2 target elimination)", () => {
  it("celebrates crossing the elimination threshold", () => {
    expect(eliminationMessage(78, 96, ["{", ":"])).toBe(
      "Target { : Eliminated! Accuracy 78% → 96%",
    );
  });

  it("reports honest partial progress below the threshold", () => {
    expect(eliminationMessage(78, 92, ["{"])).toBe(
      "Target { Improving — Accuracy 78% → 92% (needs ≥95%)",
    );
    expect(eliminationMessage(92, 80, ["{"])).toBe(
      "Target { Slipping — Accuracy 92% → 80% (needs ≥95%)",
    );
    expect(eliminationMessage(90, 90, ["{"])).toBe(
      "Target { Holding — Accuracy 90% → 90% (needs ≥95%)",
    );
  });

  it("degrades gracefully without a baseline or focus keys", () => {
    expect(eliminationMessage(null, 88, ["{"])).toBe(
      "Target {: accuracy 88% this set — no baseline yet",
    );
    expect(eliminationMessage(null, 88, [])).toBe(
      "Target —: accuracy 88% this set — no baseline yet",
    );
  });

  it("shows whitespace focus keys readably", () => {
    expect(eliminationMessage(70, 97, ["\n", " "])).toBe(
      "Target \\n ␣ Eliminated! Accuracy 70% → 97%",
    );
  });
});

describe("return-to-results hint (§7.1 sessionStorage)", () => {
  function fakeStorage(): HintStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  }

  it("round-trips the hint and consumes it on clear", () => {
    const storage = fakeStorage();
    expect(readMicroDrillReturn(storage)).toBeNull();

    stashMicroDrillReturn({ attemptId: 42 }, storage);
    expect(readMicroDrillReturn(storage)).toEqual({ attemptId: 42 });

    clearMicroDrillReturn(storage);
    expect(readMicroDrillReturn(storage)).toBeNull();
  });

  it("keeps a null attemptId (persistence-failed attempts)", () => {
    const storage = fakeStorage();
    stashMicroDrillReturn({ attemptId: null }, storage);
    expect(readMicroDrillReturn(storage)).toEqual({ attemptId: null });
  });

  it("round-trips planId and drops it when absent/foreign", () => {
    const storage = fakeStorage();
    stashMicroDrillReturn({ attemptId: 7, planId: "micro-abc" }, storage);
    expect(readMicroDrillReturn(storage)).toEqual({ attemptId: 7, planId: "micro-abc" });

    // A hint written without a planId (older build) reads fine — the
    // Weakness screen's strict `hint.planId === finishedPlan.id` match then
    // rejects it instead of offering a stale jump.
    stashMicroDrillReturn({ attemptId: 7 }, storage);
    expect(readMicroDrillReturn(storage)).toEqual({ attemptId: 7 });

    storage.data.set(
      "typekernel.microDrillReturn",
      JSON.stringify({ attemptId: 7, planId: 123 }),
    );
    expect(readMicroDrillReturn(storage)).toEqual({ attemptId: 7 });
  });

  it("treats malformed or foreign JSON as no hint at all", () => {
    const storage = fakeStorage();
    for (const raw of ["{oops", "42", "null", "\"str\"", "[]", "{}", "{\"other\":1}"]) {
      storage.data.set("typekernel.microDrillReturn", raw);
      expect(readMicroDrillReturn(storage), raw).toBeNull();
    }
  });
});

/* ---------------- §4.4 verification gate: `D` → store pipeline ------------ */

/** Types the running content, missing every 25th non-newline keystroke. */
function typeAll(content: string, missEvery = 25): void {
  const store = useSessionStore.getState();
  let index = 0;
  for (const expected of content) {
    const wrong = index % missEvery === missEvery - 1 && expected !== "\n";
    store.typeChar(wrong ? (expected === "{" ? "]" : "x") : expected);
    index += 1;
  }
}

/** Waits for the store's async finish pipeline (same pattern as drillService). */
async function waitUntil(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("micro-drill through the session store (§4.4 gates)", () => {
  let sqlite: DatabaseSync;

  beforeEach(() => {
    sqlite = connectTestDb();
  });

  afterAll(() => {
    setDbForTests(null);
  });

  it("runs the single set straight to 'finished' and persists one weakness attempt", async () => {
    await useSessionStore.getState().startDrill(planFor());
    expect(useSessionStore.getState().phase).toBe("running");

    typeAll(useSessionStore.getState().engineState!.content);
    await waitUntil(() => {
      const state = useSessionStore.getState();
      return state.persistStage === "done" && state.drill?.setResults.length === 1;
    });

    const state = useSessionStore.getState();
    // sets: 1 → the final set ends the drill, so a set-summary can never
    // appear (and the 1.5 s auto-advance never arms for a micro-drill).
    expect(state.phase).toBe("finished");
    expect(state.drill!.setResults).toHaveLength(1);
    expect(state.drill!.setResults[0].focus.total).toBeGreaterThan(0);

    const rows = sqlite
      .prepare("SELECT lesson_id, kind FROM lesson_attempts ORDER BY id")
      .all() as Array<{ lesson_id: string | null; kind: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("weakness");
    expect(rows[0].lesson_id).toBeNull();
  });

  it("keeps micro-drill metrics out of the curriculum unlock gates", async () => {
    await useSessionStore.getState().startDrill(planFor());
    typeAll(useSessionStore.getState().engineState!.content);
    await waitUntil(() => useSessionStore.getState().persistStage === "done");

    const progressRows = sqlite
      .prepare("SELECT count(*) AS n FROM lesson_progress")
      .get() as { n: number };
    expect(progressRows.n).toBe(0);
  });
});
