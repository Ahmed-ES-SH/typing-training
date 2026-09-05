import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import { keyStatsRepo } from "../db/repositories";
import { selectWeakKeys } from "./weaknessService";

/**
 * Weak-key selector tests (Phase 5 plan §3.3): ordering (worst accuracy
 * first) + the min-presses threshold (below-threshold keys excluded) +
 * the { key, shiftRequired, accuracy, presses, misses } shape shared with
 * Phase 6.
 */

/** One key's accumulated stats, inserted through the real repo. */
async function seedKey(
  key: string,
  shiftRequired: boolean,
  totalPresses: number,
  incorrectPresses: number,
): Promise<void> {
  await keyStatsRepo.recordBatch(
    [
      ...Array.from({ length: totalPresses - incorrectPresses }, () => ({
        key,
        shiftRequired,
        correct: true,
        latencyMs: 100,
      })),
      ...Array.from({ length: incorrectPresses }, () => ({
        key,
        shiftRequired,
        correct: false,
        latencyMs: 200,
      })),
    ],
    1_000,
  );
}

beforeAll(async () => {
  connectTestDb();

  // Accuracy ladder: { 78%, : 81%, ] 88%, _ 90%, ; 93%, plus two decoys —
  // one below the min-presses threshold, one clean key.
  await seedKey("{", false, 100, 22);
  await seedKey(":", true, 90, 17);
  await seedKey("]", false, 80, 10);
  await seedKey("_", true, 70, 7);
  await seedKey(";", false, 60, 4);
  await seedKey("a", false, 10, 9); // 10% accuracy but only 10 presses
  await seedKey("s", false, 500, 5); // 99% accuracy
});

afterAll(() => {
  setDbForTests(null);
});

describe("selectWeakKeys", () => {
  it("returns the worst-accuracy keys in order with the full shape", async () => {
    const keys = await selectWeakKeys(5, 30);

    expect(keys.map((k) => k.key)).toEqual(["{", ":", "]", "_", ";"]);

    const brace = keys[0];
    expect(brace).toMatchObject({
      key: "{",
      shiftRequired: false,
      presses: 100,
      misses: 22,
    });
    expect(brace.accuracy).toBeCloseTo(78, 6);

    const colon = keys[1];
    expect(colon.shiftRequired).toBe(true);
    expect(colon.accuracy).toBeCloseTo((73 / 90) * 100, 6);
  });

  it("excludes keys below the min-presses threshold", async () => {
    const keys = await selectWeakKeys(10, 30);
    expect(keys.map((k) => k.key)).not.toContain("a"); // 10 presses only
    // The accurate 500-press key survives the threshold but ranks last.
    expect(keys[keys.length - 1].key).toBe("s");
    expect(keys).toHaveLength(6);

    // Lowering the threshold admits the poorly-pressed key.
    const loose = await selectWeakKeys(10, 5);
    expect(loose[0].key).toBe("a");
    expect(loose[0].accuracy).toBeCloseTo(10, 6);
  });

  it("respects the limit", async () => {
    expect(await selectWeakKeys(2, 30)).toHaveLength(2);
    expect(await selectWeakKeys(0, 30)).toHaveLength(0);
  });

  it("degrades to an empty list on an empty key_statistics table", async () => {
    // Fresh in-memory DB with no key rows — the selector must return [].
    connectTestDb();
    const keys = await selectWeakKeys(5, 30);
    expect(keys).toEqual([]);
    setDbForTests(null);
  });
});
