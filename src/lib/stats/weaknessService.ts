import { keyStatsRepo } from "../db/repositories";
import type { KeyStatRow } from "../schemas";
import { windowAccuracy, type CharSeries } from "../intelligence/analyzer";

/**
 * Weak-key selector (PRD §14/§15 feed; Phase 5 plan §3.3, Phase 6 refactor).
 *
 * Phase 6: the threshold/ordering decision now lives in the intelligence
 * analyzer (`windowAccuracy` over per-char series — the exact logic the
 * 30-day weakness queue uses); this lifetime variant feeds each key's
 * aggregate through it as a single synthetic day. Signature and behavior
 * are preserved for the Dashboard radar: lowest accuracy first (ties: more
 * misses first, computed by SQL), `minPresses` gate before a key may be
 * called weak.
 */

export interface WeakKey {
  key: string;
  shiftRequired: boolean;
  /** 0–100, mean over the key's samples. */
  accuracy: number;
  presses: number;
  misses: number;
}

export async function selectWeakKeys(
  limit = 5,
  minPresses = 30,
): Promise<WeakKey[]> {
  const rows = await keyStatsRepo.weakKeys(minPresses, limit);
  return rows.map(toWeakKey).slice(0, limit);
}

/** Maps one lifetime row through the analyzer's accuracy window logic. */
function toWeakKey(row: KeyStatRow): WeakKey {
  const series: CharSeries = {
    key: row.key,
    shiftRequired: row.shiftRequired,
    rows: [
      {
        day: "",
        presses: row.totalPresses,
        correct: row.correctPresses,
      },
    ],
  };
  const window = windowAccuracy(series.rows, 1);
  return {
    key: row.key,
    shiftRequired: row.shiftRequired,
    accuracy: window?.accuracy ?? 0,
    presses: row.totalPresses,
    misses: row.incorrectPresses,
  };
}
