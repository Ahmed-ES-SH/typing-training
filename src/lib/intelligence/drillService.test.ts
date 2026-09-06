import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import { attemptsRepo, settingsRepo } from "../db/repositories";
import { useSessionStore } from "../../stores/useSessionStore";
import {
  buildDrillPlan,
  DEFAULT_DRILL_CONFIG,
  DRILL_CONFIG_KEY,
  focusKeyStatsOf,
  getDrillConfig,
  newDrillSeed,
  setDrillConfig,
  type DrillPlan,
} from "./drillService";
import type { WeaknessAnalysis } from "./analyzer";

/**
 * Drill service tests (Phase 6 plan §5.1): set sequencing (5 sets), focus
 * hit accounting, kind='weakness' persistence through the store's finish
 * pipeline, config defaults, and curriculum untouched.
 */

const NOW = new Date("2026-09-05T12:00:00").getTime();

function fakeAnalysis(): WeaknessAnalysis {
  return {
    targets: [
      { key: "{", shiftRequired: false, accuracy: 78, presses: 100, misses: 22, state: "targeted", priority: 1, stateSince: "2026-09-01" },
      { key: ":", shiftRequired: true, accuracy: 81, presses: 90, misses: 17, state: "targeted", priority: 2, stateSince: "2026-09-01" },
      { key: "]", shiftRequired: false, accuracy: 88, presses: 80, misses: 10, state: "targeted", priority: 3, stateSince: "2026-09-01" },
    ],
    combos: [{ pair: "::", errorRate: 14, total: 50 }],
    patterns: [],
    slowest: [],
    empty: false,
  };
}

/** Types `content` fully into the running session (mixed accuracy). */
function typeAll(content: string, missEvery = 25): void {
  const store = useSessionStore.getState();
  let index = 0;
  for (const expected of content) {
    const wrong = index % missEvery === missEvery - 1 && expected !== "\n";
    store.typeChar(wrong && expected !== "\n" ? (expected === "{" ? "]" : "x") : expected);
    index += 1;
  }
}

/** Waits until `cond` turns true (the finish pipeline is async). */
async function waitUntil(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

let sqlite: DatabaseSync;
let plan: DrillPlan;

beforeEach(async () => {
  sqlite = connectTestDb();
  plan = buildDrillPlan(fakeAnalysis(), { ...DEFAULT_DRILL_CONFIG }, 77, 3);
});

afterAll(() => {
  setDbForTests(null);
});

describe("buildDrillPlan", () => {
  it("builds 5 sets of ~120 keystrokes with the design defaults", () => {
    expect(plan.sets).toHaveLength(DEFAULT_DRILL_CONFIG.sets); // 5
    for (const set of plan.sets) {
      expect(set.content.length).toBe(120);
    }
    expect(plan.focusKeys).toEqual(["{", ":", "]"]);
  });

  it("is deterministic per (analysis, seed)", () => {
    const again = buildDrillPlan(fakeAnalysis(), { ...DEFAULT_DRILL_CONFIG }, 77, 3);
    expect(again.sets.map((s) => s.content)).toEqual(plan.sets.map((s) => s.content));
    const other = buildDrillPlan(fakeAnalysis(), { ...DEFAULT_DRILL_CONFIG }, 78, 3);
    expect(other.sets[0].content).not.toEqual(plan.sets[0].content);
  });
});

describe("focusKeyStatsOf", () => {
  it("accounts hits/misses and lead-char misses (design: 61/72, 9 misses)", () => {
    const events = [
      { expected: "{", correct: true },
      { expected: "a", correct: true },
      { expected: "{", correct: false },
      { expected: ":", correct: false },
      { expected: "{", correct: true },
      { expected: "b", correct: false },
    ];
    const stats = focusKeyStatsOf(events, ["{", ":"]);
    expect(stats).toEqual({ hits: 2, misses: 2, total: 4, leadMisses: 1 });
  });

  it("returns zeros for an empty event list", () => {
    expect(focusKeyStatsOf([], ["{"])).toEqual({
      hits: 0,
      misses: 0,
      total: 0,
      leadMisses: 0,
    });
  });
});

describe("drill session lifecycle (store pipeline)", () => {
  it("runs all 5 sets, persists kind='weakness' attempts and closes the session", async () => {
    await useSessionStore.getState().startDrill(plan);
    expect(useSessionStore.getState().phase).toBe("running");
    const sessionId = useSessionStore.getState().trainingSessionId;
    expect(sessionId).not.toBeNull();

    for (let set = 0; set < 5; set++) {
      expect(useSessionStore.getState().drill?.setIndex).toBe(set);
      if (set > 0) {
        expect(useSessionStore.getState().phase).toBe("set-summary");
        useSessionStore.getState().resumeDrill();
      }
      typeAll(useSessionStore.getState().engineState!.content);
      // Wait for the finish pipeline: mid-drill it advances setIndex (and
      // resets persistStage in the same atomic update); after the final set
      // it marks persistStage done with all 5 results recorded.
      await waitUntil(() => {
        const s = useSessionStore.getState();
        return set < 4
          ? s.drill?.setIndex === set + 1
          : s.persistStage === "done" && s.drill?.setResults.length === 5;
      });
    }

    const state = useSessionStore.getState();
    expect(state.phase).toBe("finished");
    expect(state.drill?.setResults).toHaveLength(5);
    expect(state.drill?.setIndex).toBe(4);
    // Focus accounting ran per set.
    expect(state.drill?.setResults[0].focus.total).toBeGreaterThan(0);

    // One attempt row PER SET, kind weakness, lesson_id NULL.
    const rows = sqlite
      .prepare("SELECT lesson_id, kind, attempt_number, wpm FROM lesson_attempts ORDER BY id")
      .all() as Array<{ lesson_id: string | null; kind: string; attempt_number: number; wpm: number }>;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.lesson_id === null && r.kind === "weakness")).toBe(true);
    expect(rows.map((r) => r.attempt_number)).toEqual([1, 2, 3, 4, 5]);

    // Training session closed with the drill's total chars.
    const session = sqlite
      .prepare("SELECT ended_at, duration_ms, chars_typed, kind, lesson_id FROM training_sessions WHERE id = ?")
      .get(sessionId) as { ended_at: number | null; duration_ms: number | null; chars_typed: number; kind: string; lesson_id: string | null };
    expect(session.ended_at).not.toBeNull();
    expect(session.kind).toBe("weakness");
    expect(session.lesson_id).toBeNull();
    expect(session.chars_typed).toBe(5 * 120);
  });

  it("never touches lesson_progress (drill metrics stay out of gates)", async () => {
    await useSessionStore.getState().startDrill(plan);
    typeAll(useSessionStore.getState().engineState!.content);
    await waitUntil(() => useSessionStore.getState().persistStage === "done");

    const progressRows = sqlite.prepare("SELECT count(*) AS n FROM lesson_progress").get() as { n: number };
    expect(progressRows.n).toBe(0);
  });

  it("writes key statistics + daily rollups + bigrams for drill sets", async () => {
    await useSessionStore.getState().startDrill(plan);
    typeAll(useSessionStore.getState().engineState!.content);
    await waitUntil(() => useSessionStore.getState().persistStage === "done");

    const lifetime = sqlite.prepare("SELECT count(*) AS n FROM key_statistics").get() as { n: number };
    expect(lifetime.n).toBeGreaterThan(0);
    const daily = sqlite.prepare("SELECT count(*) AS n FROM key_statistics_daily").get() as { n: number };
    expect(daily.n).toBeGreaterThan(0);
    const bigrams = sqlite.prepare("SELECT count(*) AS n FROM bigram_statistics").get() as { n: number };
    expect(bigrams.n).toBeGreaterThan(0);
  });

  it("abandoning a drill resets the runtime and closes its session row", async () => {
    await useSessionStore.getState().startDrill(plan);
    const sessionId = useSessionStore.getState().trainingSessionId;
    useSessionStore.getState().typeChar("{");
    await useSessionStore.getState().abandon();

    expect(useSessionStore.getState().drill).toBeNull();
    expect(useSessionStore.getState().phase).toBe("idle");
    const row = sqlite
      .prepare("SELECT ended_at FROM training_sessions WHERE id = ?")
      .get(sessionId) as { ended_at: number | null };
    expect(row.ended_at).not.toBeNull();
    const attempts = sqlite.prepare("SELECT count(*) AS n FROM lesson_attempts").get() as { n: number };
    expect(attempts.n).toBe(0);
  });

  it("drill attempts stay out of lesson aggregates but count for streaks", async () => {
    await useSessionStore.getState().startDrill(plan);
    typeAll(useSessionStore.getState().engineState!.content);
    await waitUntil(() => useSessionStore.getState().drill?.setIndex === 1);

    // Lesson-scoped aggregates exclude drill rows...
    expect(await attemptsRepo.countAll()).toBe(0);
    // ...while the unified ledger still holds kind='weakness' rows.
    const kinds = sqlite
      .prepare("SELECT kind FROM lesson_attempts")
      .all() as Array<{ kind: string }>;
    expect(kinds.length).toBe(1);
    expect(kinds[0].kind).toBe("weakness");
    // And finished drills (any kind) count as active streak days.
    const days = await attemptsRepo.distinctActiveDays();
    expect(days).toHaveLength(1); // the drill attempt is completed=true
  });
});

describe("drill config", () => {
  it("defaults to the design values and round-trips through settings", async () => {
    expect(await getDrillConfig()).toEqual(DEFAULT_DRILL_CONFIG);

    await setDrillConfig({ ...DEFAULT_DRILL_CONFIG, symbolWeight: 4, sets: 3 });
    const config = await getDrillConfig();
    expect(config.symbolWeight).toBe(4);
    expect(config.sets).toBe(3);

    // Invalid persisted shapes heal to the defaults.
    await settingsRepo.set(DRILL_CONFIG_KEY, {
      ...DEFAULT_DRILL_CONFIG,
      symbolWeight: 99,
    });
    expect((await getDrillConfig()).symbolWeight).toBe(3);
  });

  it("newDrillSeed yields positive 31-bit integers", () => {
    for (let i = 0; i < 50; i++) {
      const seed = newDrillSeed(NOW + i);
      expect(seed).toBeGreaterThan(0);
      expect(seed).toBeLessThan(0x80000000);
    }
  });
});
