import { describe, expect, it } from "vitest";

import { applyEvent, createSession, isFinished } from "./engine";
import { liveMetrics } from "./metrics";

/**
 * Keystroke-path throughput harness (Phase 8 plan §3.4).
 *
 * A synthetic 10k-keystroke session through the REAL reducer must sustain
 * well above 500 keys/s INCLUDING `liveMetrics` recomputation on the 200 ms
 * tick cadence (one metrics call per 40 keys ≈ 5 calls/s at full speed).
 * This guards the §25 "first keystroke echo < 16 ms" budget at the engine
 * level: per-key work must stay microseconds, not milliseconds.
 *
 * Note on `applyEvent` costs: the reducer copies the entries array per event
 * (O(n) in buffer length) — the assertion below pins the real-world bound
 * for lesson-sized buffers (~10k chars), not an asymptotic claim.
 */

const KEYS = 10_000;
/** Floor: the session must clear 500 keys/s end to end. */
const MIN_KEYS_PER_SECOND = 500;

function buildContent(length: number): string {
  const line = "const value = items.map((item) => item.value + 1); // drill\n";
  return line.repeat(Math.ceil(length / line.length)).slice(0, length);
}

describe("typing engine throughput (synthetic 10k-keystroke session)", () => {
  it(`sustains > ${MIN_KEYS_PER_SECOND} keys/s with tick metrics recomputation`, () => {
    const content = buildContent(KEYS);
    let state = createSession(content);
    // Deterministic 5% error rate: every 20th keystroke misses.
    const mistype = (expected: string) => (expected === "x" ? "q" : "x");

    const startedAt = performance.now();
    let now = 1_700_000_000_000;
    for (let i = 0; i < content.length; i++) {
      const expected = content[i];
      const typed = i % 20 === 19 ? mistype(expected) : expected;
      now += 8; // ~125 WPM synthetic cadence
      state = applyEvent(state, { type: "char", char: typed }, now);
      // 200 ms tick recomputation (metrics are O(1) selectors).
      if (i % 40 === 0) void liveMetrics(state, now);
    }
    const metrics = liveMetrics(state, now);
    const elapsedSec = (performance.now() - startedAt) / 1000;

    expect(isFinished(state)).toBe(true);
    expect(state.correctChars + state.incorrectChars).toBe(KEYS);
    // Sanity: the synthetic error pattern survived the reducer.
    expect(metrics.accuracy).toBeGreaterThan(90);
    expect(metrics.accuracy).toBeLessThan(100);

    const keysPerSecond = KEYS / Math.max(elapsedSec, 1e-6);
    // eslint-disable-next-line no-console
    console.info(
      `[perf] engine throughput: ${Math.round(keysPerSecond)} keys/s ` +
        `(${KEYS} keys in ${(elapsedSec * 1000).toFixed(0)} ms, budget > ${MIN_KEYS_PER_SECOND}/s)`,
    );
    expect(keysPerSecond).toBeGreaterThan(MIN_KEYS_PER_SECOND);
  });
});
