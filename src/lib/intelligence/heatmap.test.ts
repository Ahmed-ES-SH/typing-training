import { describe, expect, it } from "vitest";

import { QWERTY_US } from "../layout/qwerty";
import { findKey } from "../layout";
import {
  bucketFor,
  buildHeatmapCells,
  getCharAccuracy,
  HEAT_BG,
  type CharAccuracy,
} from "./heatmap";

/**
 * Heatmap tests (Phase 6 plan §5.1): every §6 programming symbol lands on a
 * valid cell, the bucket edges match the design legend exactly
 * (84.9/85/93/97), and shift pairs merge onto one physical key with
 * press-weighted accuracy.
 */

const char = (
  c: string,
  presses: number,
  correct: number,
  avgLatencyMs?: number,
): CharAccuracy => ({
  char: c,
  shiftRequired: c !== c.toLowerCase(),
  presses,
  correct,
  avgLatencyMs,
});

describe("bucketFor (design legend edges)", () => {
  it.each([
    [0, "weak"],
    [84.9, "weak"],
    [85, "below"],
    [92.9, "below"],
    [93, "avg"],
    [96.9, "avg"],
    [97, "strong"],
    [100, "strong"],
  ] as const)("accuracy %s%% -> %s", (accuracy, bucket) => {
    expect(bucketFor(accuracy)).toBe(bucket);
  });

  it("uses the exact statistics-design palette", () => {
    expect(HEAT_BG.weak).toBe("#4a1d06");
    expect(HEAT_BG.below).toBe("#9d4300");
    expect(HEAT_BG.avg).toBe("#d97722");
    expect(HEAT_BG.strong).toBe("#ffb783");
  });
});

describe("buildHeatmapCells", () => {
  it("maps EVERY §6 programming symbol onto a valid cell", () => {
    const symbols = [
      "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+",
      "{", "}", "|", ":", '"', "<", ">", "?", "[", "]", "\\", ";", "'",
      "`", "-", "=", "/", ".", ",",
    ];
    const cells = buildHeatmapCells(QWERTY_US, symbols.map((s) => char(s, 50, 45)));
    const byId = new Map(cells.map((cell) => [cell.keyId, cell]));
    for (const symbol of symbols) {
      const key = findKey(QWERTY_US, symbol);
      expect(key, `symbol ${symbol} unmapped`).not.toBeNull();
      const cell = byId.get(key!.key.id);
      expect(cell, `symbol ${symbol} missing cell`).toBeDefined();
      expect(cell!.bucket).not.toBe("nodata");
      expect(cell!.chars.some((c) => c.char === symbol)).toBe(true);
    }
  });

  it("merges shift pairs onto one cell with press-weighted accuracy", () => {
    // `[`: 100 presses at 100% ; `{`: 100 presses at 60%.
    const cells = buildHeatmapCells(
      QWERTY_US,
      [char("[", 100, 100), char("{", 100, 60)],
    );
    const cell = cells.find((c) => c.keyId === "bracket-l")!;
    expect(cell.accuracy).toBeCloseTo(80, 6); // (100 + 60) / 200
    expect(cell.bucket).toBe("weak"); // 80% < 85
    expect(cell.chars).toHaveLength(2);
    expect(cell.misses).toBe(40);
  });

  it("leaves keys without data as nodata and specials stay gray", () => {
    const cells = buildHeatmapCells(QWERTY_US, [char("a", 50, 49)]);
    const b = cells.find((c) => c.keyId === "b")!;
    expect(b.bucket).toBe("nodata");
    expect(b.accuracy).toBeNull();
    const tab = cells.find((c) => c.keyId === "tab")!;
    expect(tab.kind).toBe("special");
    expect(tab.bucket).toBe("nodata");
  });

  it("press-weights latency across merged chars", () => {
    const cells = buildHeatmapCells(
      QWERTY_US,
      [char("9", 100, 99, 100), char("(", 300, 280, 200)],
    );
    const cell = cells.find((c) => c.keyId === "digit-9")!;
    expect(cell.avgLatencyMs).toBeCloseTo((100 * 100 + 200 * 300) / 400, 6);
  });

  it("upper-cases letter labels per the design", () => {
    const cells = buildHeatmapCells(QWERTY_US, []);
    expect(cells.find((c) => c.keyId === "q")!.label).toBe("Q");
    expect(cells.find((c) => c.keyId === "bracket-l")!.label).toBe("[");
  });

  it("ignores unmapped chars (newlines) without throwing", () => {
    const cells = buildHeatmapCells(QWERTY_US, [char("\n", 10, 10)]);
    expect(cells.every((c) => c.chars.length === 0 || c.keyId !== "enter")).toBe(true);
  });
});

describe("getCharAccuracy window merge", () => {
  it("merges 30d daily rows and falls back to lifetime for uncovered chars", async () => {
    const { connectTestDb } = await import("../db/testing");
    const { setDbForTests } = await import("../db/client");
    const { keyStatsRepo } = await import("../db/repositories");
    connectTestDb();

    const now = new Date("2026-09-05T12:00:00").getTime();
    const dayKey = (offset: number) => {
      const d = new Date(now - offset * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    // `{` has daily coverage (90% over 2 days).
    for (const offset of [0, 1]) {
      await keyStatsRepo.recordDaily(
        Array.from({ length: 50 }, (_, i) => ({
          key: "{",
          shiftRequired: false,
          correct: i >= 5,
          latencyMs: 100,
        })),
        dayKey(offset),
      );
    }
    // `@` has ONLY lifetime data (92%) — the fallback path.
    await keyStatsRepo.recordBatch(
      [
        ...Array.from({ length: 46 }, () => ({
          key: "@",
          shiftRequired: true,
          correct: true,
          latencyMs: 150,
        })),
        ...Array.from({ length: 4 }, () => ({
          key: "@",
          shiftRequired: true,
          correct: false,
          latencyMs: 250,
        })),
      ],
      now,
    );

    const acc30 = await getCharAccuracy("30d", now);
    const brace = acc30.find((c) => c.char === "{")!;
    expect(brace.presses).toBe(100);
    expect(brace.correct).toBe(90);
    const at = acc30.find((c) => c.char === "@")!;
    expect(at.presses).toBe(50);
    expect(at.correct).toBe(46);

    // Lifetime window reads the aggregates directly (latency included);
    // `{` exists only as daily rollups so it is absent from lifetime stats.
    const accAll = await getCharAccuracy("lifetime", now);
    expect(accAll.find((c) => c.char === "{")).toBeUndefined();
    expect(accAll.find((c) => c.char === "@")!.presses).toBe(50);
    expect(accAll.find((c) => c.char === "@")!.avgLatencyMs).toBeDefined();

    setDbForTests(null);
  });
});
