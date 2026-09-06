import { afterAll, describe, expect, it } from "vitest";

import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import {
  attemptsRepo,
  bigramStatsRepo,
  keyStatsRepo,
  lessonsRepo,
  settingsRepo,
} from "../db/repositories";
import { getLesson } from "../../content";
import {
  analyzeWeaknesses,
  computeQueue,
  consecutiveDaysAt,
  dayKeyBefore,
  groupDailyRows,
  MAX_TARGETED,
  MIN_PRESSES,
  patternsFromReports,
  projectRecovery,
  rankCombos,
  targetsToWeakKeys,
  windowAccuracy,
  type CharSeries,
  type DayAccuracy,
} from "./analyzer";
import { WEAKNESS_QUEUE_KEY } from "./analyzer";
import type { QueueEntry } from "../schemas";

/**
 * Analyzer tests (Phase 6 plan §5.1): threshold edges (89.9 → targeted,
 * 90.0 × 7 days → maintenance, 95 × 7 days → eliminated), the max-6 queue
 * cap, maintenance → elimination, and the persisted-queue round trip.
 * The pure core is tested directly; `analyzeWeaknesses` runs against the
 * real migration SQL via the node:sqlite harness.
 */

const TODAY = new Date("2026-09-05T12:00:00").getTime();

/** Builds a daily series of `days` active days ending today. */
function series(
  key: string,
  shiftRequired: boolean,
  days: DayAccuracy[],
): CharSeries {
  return { key, shiftRequired, rows: days };
}

function day(offsetFromToday: number, presses: number, correct: number): DayAccuracy {
  // offset 0 = today, 1 = yesterday, ...
  return { day: dayKeyBefore(TODAY, offsetFromToday), presses, correct };
}

afterAll(() => {
  setDbForTests(null);
});

describe("windowAccuracy", () => {
  it("computes accuracy over the series and respects the min-presses gate", () => {
    const rows = [day(0, 50, 44), day(1, 50, 45)];
    const window = windowAccuracy(rows);
    expect(window).not.toBeNull();
    expect(window!.presses).toBe(100);
    expect(window!.accuracy).toBeCloseTo(89, 6);
    expect(window!.misses).toBe(11);
  });

  it("returns null below MIN_PRESSES (one-off typos are not weakness)", () => {
    expect(windowAccuracy([day(0, MIN_PRESSES - 1, 0)])).toBeNull();
    expect(windowAccuracy([day(0, MIN_PRESSES, 0)])).not.toBeNull();
  });
});

describe("consecutiveDaysAt", () => {
  it("counts the trailing run of active days at/above the threshold", () => {
    const rows = [
      day(-6, 10, 9), // 90% -> at threshold
      day(-5, 10, 10),
      day(-4, 10, 10),
      day(-3, 10, 8), // 80% breaks the run
      day(-2, 10, 10),
      day(-1, 10, 10),
      day(0, 10, 10),
    ];
    expect(consecutiveDaysAt(rows, 90)).toBe(3);
  });

  it("is 0 when the most recent active day is below the threshold", () => {
    expect(consecutiveDaysAt([day(0, 10, 8)], 90)).toBe(0);
  });
});

describe("computeQueue lifecycle", () => {
  it("targets a char below 90% (threshold edge at 89%)", () => {
    const entries = computeQueue(
      [series("{", false, [day(0, 100, 89)])],
      [],
      "2026-09-05",
    );
    // 89% < 90 → targeted.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: "{", state: "targeted" });
  });

  it("holds targeted at 90.0% until 7 consecutive active days", () => {
    const good = (n: number) =>
      Array.from({ length: n }, (_, i) => day(i, 100, 90)); // exactly 90.0
    const prev: QueueEntry[] = [
      { key: ":", shiftRequired: true, state: "targeted", stateSince: "2026-08-01" },
    ];
    // Only 6 qualifying days -> stays targeted (original anchor kept).
    const short = computeQueue([series(":", true, good(6))], prev, "2026-09-05");
    expect(short[0].state).toBe("targeted");
    expect(short[0].stateSince).toBe("2026-08-01");

    // 7 qualifying days -> maintenance, anchored at the streak start.
    const long = computeQueue([series(":", true, good(7))], prev, "2026-09-05");
    expect(long[0].state).toBe("maintenance");
    expect(long[0].stateSince).toBe(dayKeyBefore(TODAY, 6));
  });

  it("never queues healthy chars that were never targeted", () => {
    const rows = Array.from({ length: 10 }, (_, i) => day(i, 100, 99));
    expect(computeQueue([series("]", false, rows)], [], "2026-09-05")).toEqual([]);
  });

  it("moves maintenance -> eliminated after 7 days at >= 95%", () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      i < 2 ? day(8 - i, 100, 92) : day(8 - i, 100, 96),
    );
    const prev: QueueEntry[] = [
      { key: "]", shiftRequired: false, state: "maintenance", stateSince: "2026-08-25" },
    ];
    const entries = computeQueue([series("]", false, rows)], prev, "2026-09-05");
    expect(entries[0].state).toBe("eliminated");
    expect(entries[0].stateSince).toBe(dayKeyBefore(TODAY, 6)); // first 95% day
  });

  it("keeps eliminated keys eliminated while they stay >= 90%", () => {
    const rows = Array.from({ length: 8 }, (_, i) => day(i, 100, 97));
    const prev: QueueEntry[] = [
      { key: ";", shiftRequired: false, state: "eliminated", stateSince: "2026-08-20" },
    ];
    const entries = computeQueue([series(";", false, rows)], prev, "2026-09-05");
    expect(entries[0].state).toBe("eliminated");
    expect(entries[0].stateSince).toBe("2026-08-20"); // original graduation kept
  });

  it("re-targets an eliminated key that drops back below 90%", () => {
    const rows = Array.from({ length: 8 }, (_, i) => day(i, 100, 85));
    const prev: QueueEntry[] = [
      { key: ";", shiftRequired: false, state: "eliminated", stateSince: "2026-08-20" },
    ];
    const entries = computeQueue([series(";", false, rows)], prev, "2026-09-05");
    expect(entries[0].state).toBe("targeted");
  });

  it("demotes maintenance back to targeted below the 90% line", () => {
    const rows = Array.from({ length: 8 }, (_, i) => day(i, 100, 88));
    const prev: QueueEntry[] = [
      { key: "_", shiftRequired: true, state: "maintenance", stateSince: "2026-08-25" },
    ];
    const entries = computeQueue([series("_", true, rows)], prev, "2026-09-05");
    expect(entries[0].state).toBe("targeted");
  });

  it("caps targeted keys at 6 (worst accuracy kept, overflow dropped)", () => {
    // 8 weak chars, accuracies 89.5% ("a") down to 82.5% ("h").
    const weak = ["a", "b", "c", "d", "e", "f", "g", "h"].map((key, i) =>
      series(key, false, [day(0, 200, 179 - i * 2)]),
    );
    const entries = computeQueue(weak, [], "2026-09-05");
    const targeted = entries.filter((e) => e.state === "targeted");
    expect(targeted).toHaveLength(MAX_TARGETED);
    // Worst six survive; the two least-bad ("a", "b") overflow out.
    expect(targeted.map((e) => e.key)).not.toContain("a");
    expect(targeted.map((e) => e.key)).not.toContain("b");
    expect(targeted.map((e) => e.key)).toContain("h");
  });

  it("keeps the previous entry untouched when data is insufficient", () => {
    const prev: QueueEntry[] = [
      { key: "{", shiftRequired: false, state: "maintenance", stateSince: "2026-08-01" },
    ];
    // Under MIN_PRESSES in the window.
    const entries = computeQueue(
      [series("{", false, [day(0, 5, 1)])],
      prev,
      "2026-09-05",
    );
    expect(entries).toEqual(prev);
  });
});

describe("analyzeWeaknesses (integration over the migration SQL)", () => {
  it("builds a queue from seeded daily rollups and persists it", async () => {
    connectTestDb();
    // Seed daily rows: `{` weak (88%), `:` was targeted and now holds
    // exactly 90% for the whole window, `_` was in maintenance and hit 96%
    // for the last 8 days, `]` healthy and never queued.
    const weakEvents = (char: string, presses: number, wrong: number) =>
      Array.from({ length: presses }, (_, i) => ({
        key: char,
        shiftRequired: char === ":" || char === "_",
        correct: i >= wrong,
        latencyMs: 120,
      }));

    for (let d = 0; d <= 29; d++) {
      await keyStatsRepo.recordDaily(weakEvents("{", 50, 6), dayKeyBefore(TODAY, d)); // 88%
      await keyStatsRepo.recordDaily(weakEvents(":", 50, 5), dayKeyBefore(TODAY, d)); // 90%
      // `_`: 92% except the last 8 days at 96%.
      await keyStatsRepo.recordDaily(
        weakEvents("_", 50, d < 8 ? 2 : 4),
        dayKeyBefore(TODAY, d),
      );
      await keyStatsRepo.recordDaily(weakEvents("]", 50, 1), dayKeyBefore(TODAY, d)); // 98%
    }
    // Pre-existing queue state: `:` targeted, `_` maintenance (they earned
    // those states before this analysis ran).
    await settingsRepo.set(WEAKNESS_QUEUE_KEY, [
      { key: ":", shiftRequired: true, state: "targeted", stateSince: "2026-08-01" },
      { key: "_", shiftRequired: true, state: "maintenance", stateSince: "2026-08-10" },
    ]);

    const analysis = await analyzeWeaknesses(TODAY);
    const states = new Map(analysis.targets.map((t) => [t.key, t.state]));
    expect(states.get("{")).toBe("targeted");
    expect(states.get(":")).toBe("maintenance"); // 7+ days at 90 -> graduated
    expect(states.get("_")).toBe("eliminated"); // 8 days at 96 -> eliminated
    expect(states.has("]")).toBe(false); // healthy, never queued

    const targeted = analysis.targets.filter((t) => t.state === "targeted");
    expect(targeted[0].priority).toBe(1);
    expect(targeted[0].key).toBe("{");
    expect(targeted[0].accuracy).toBeCloseTo(88, 6);

    // Queue persisted under the settings key; re-runs are idempotent.
    const persisted = await settingsRepo.get(WEAKNESS_QUEUE_KEY);
    expect(Array.isArray(persisted)).toBe(true);
    const again = await analyzeWeaknesses(TODAY);
    expect(again.targets.map((t) => [t.key, t.state])).toEqual(
      analysis.targets.map((t) => [t.key, t.state]),
    );
  });

  it("falls back to lifetime key_statistics when daily rows are missing", async () => {
    connectTestDb();
    // Lifetime-only data (no daily rows): recordBatch writes key_statistics.
    await keyStatsRepo.recordBatch(
      [
        ...Array.from({ length: 88 }, () => ({
          key: "@",
          shiftRequired: true,
          correct: true,
          latencyMs: 100,
        })),
        ...Array.from({ length: 12 }, () => ({
          key: "@",
          shiftRequired: true,
          correct: false,
          latencyMs: 300,
        })),
      ],
      TODAY,
    );
    const analysis = await analyzeWeaknesses(TODAY);
    const at = analysis.targets.find((t) => t.key === "@");
    expect(at).toBeDefined();
    expect(at!.state).toBe("targeted");
    expect(at!.accuracy).toBeCloseTo(88, 6);
  });

  it("returns empty: true on a fresh database", async () => {
    connectTestDb();
    const analysis = await analyzeWeaknesses(TODAY);
    expect(analysis.empty).toBe(true);
    expect(analysis.targets).toEqual([]);
    expect(analysis.combos).toEqual([]);
  });

  it("ranks combos from bigram rollups and patterns from key reports", async () => {
    connectTestDb();
    await lessonsRepo.upsert(getLesson("l1-001")!);
    // "->" often wrong (30%), "::" less often (10%), "ab" rare (below
    // minTotal). "\n" separators keep the pairs isolated in the stream.
    const events = (pair: string, repeats: number, wrong: number) => {
      const out: Parameters<typeof bigramStatsRepo.recordBatch>[0] = [];
      for (let i = 0; i < repeats; i++) {
        out.push(
          { key: pair[0], shiftRequired: false, correct: true, latencyMs: 50 },
          {
            key: pair[1],
            shiftRequired: false,
            correct: i >= wrong,
            latencyMs: 60,
          },
          { key: "\n", shiftRequired: false, correct: true, latencyMs: 0 },
        );
      }
      return out;
    };
    await bigramStatsRepo.recordBatch(events("->", 20, 6)); // 30% error
    await bigramStatsRepo.recordBatch(events("::", 20, 2)); // 10% error
    await bigramStatsRepo.recordBatch(events("ab", 5, 5)); // below min total

    // Two attempts, each missing ")" 2 times => 4 misses (>= 3).
    for (let a = 0; a < 2; a++) {
      await attemptsRepo.insertWithNextNumber(
        {
          lessonId: "l1-001",
          wpm: 50,
          accuracy: 95,
          errorRate: 5,
          errorCount: 2,
          correctChars: 100,
          incorrectChars: 2,
          backspaceCount: 1,
          durationMs: 50_000,
          completed: true,
          startedAt: TODAY,
          finishedAt: TODAY + 50_000,
        },
        [
          {
            key: ")",
            shiftRequired: false,
            totalPresses: 2,
            incorrectPresses: 2,
            avgLatencyMs: 100,
          },
        ],
      );
    }
    const analysis = await analyzeWeaknesses(TODAY);
    expect(analysis.combos[0]).toMatchObject({ pair: "->", errorRate: 30 });
    expect(analysis.combos.some((c) => c.pair === "ab")).toBe(false);
    expect(analysis.patterns).toEqual([
      expect.objectContaining({ key: ")", misses: 4 }),
    ]);
  });
});

describe("pure aggregation helpers", () => {
  it("groupDailyRows sorts rows chronologically per char", () => {
    const grouped = groupDailyRows([
      { date: "2026-09-03", key: "{", shiftRequired: false, presses: 5, correct: 4 },
      { date: "2026-09-01", key: "{", shiftRequired: false, presses: 5, correct: 5 },
    ]);
    expect(grouped[0].rows.map((r) => r.day)).toEqual(["2026-09-01", "2026-09-03"]);
  });

  it("patternsFromReports aggregates misses across reports", () => {
    const patterns = patternsFromReports(
      [
        [{ key: "{", shiftRequired: false, totalPresses: 4, incorrectPresses: 2, avgLatencyMs: 100 }],
        null,
        [{ key: "{", shiftRequired: false, totalPresses: 3, incorrectPresses: 1, avgLatencyMs: 100 }],
      ],
      3,
    );
    expect(patterns).toEqual([expect.objectContaining({ key: "{", misses: 3 })]);
  });

  it("rankCombos sorts by error rate then volume", () => {
    const combos = rankCombos(
      [
        { pair: "aa", total: 100, incorrect: 10, avgLatencyMs: 1 },
        { pair: "bb", total: 10, incorrect: 3, avgLatencyMs: 1 },
        { pair: "cc", total: 20, incorrect: 6, avgLatencyMs: 1 },
        { pair: "dd", total: 2, incorrect: 2, avgLatencyMs: 1 },
      ],
      10,
    );
    expect(combos.map((c) => c.pair)).toEqual(["cc", "bb", "aa"]);
  });
});

describe("projectRecovery + targetsToWeakKeys", () => {
  it("anchors the projection at the rolling-30d accuracy the queue shows", () => {
    // Daily series ending at 100% on the last day while the rolling-30d
    // window sits at 84% — the projection must start from the override
    // (the queue card's number), not from the last single day.
    const rows = Array.from({ length: 10 }, (_, i) =>
      day(9 - i, 50, Math.min(50, 41 + i)),
    );
    const plain = projectRecovery(rows);
    expect(plain.current).toBeCloseTo(100, 6); // last day (the old bug)

    const anchored = projectRecovery(rows, 84);
    expect(anchored.current).toBe(84);
    expect(anchored.projected).toBeCloseTo(Math.min(100, 84 + anchored.slopePerDay * 7), 6);
    expect(anchored.etaDays).not.toBeNull(); // 84 < 95 and improving
  });

  it("targetsToWeakKeys maps queue targets sorted worst-accuracy-first", () => {
    const analysis = {
      targets: [
        { key: ":", shiftRequired: true, accuracy: 81, presses: 90, misses: 17, state: "maintenance" as const, priority: null, stateSince: "2026-08-20" },
        { key: "{", shiftRequired: false, accuracy: 78, presses: 100, misses: 22, state: "targeted" as const, priority: 1, stateSince: "2026-09-01" },
        { key: "]", shiftRequired: false, accuracy: 88, presses: 80, misses: 10, state: "targeted" as const, priority: 2, stateSince: "2026-09-01" },
      ],
      combos: [],
      patterns: [],
      slowest: [],
      empty: false,
    };
    const keys = targetsToWeakKeys(analysis);
    // Dashboard radar order: worst accuracy first regardless of queue state.
    expect(keys.map((k) => k.key)).toEqual(["{", ":", "]"]);
    expect(keys[0]).toMatchObject({
      key: "{",
      shiftRequired: false,
      accuracy: 78,
      presses: 100,
      misses: 22,
    });
  });
});
