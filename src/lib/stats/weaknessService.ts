import { keyStatsRepo } from "../db/repositories";

/**
 * Weak-key selector (PRD §14/§15 feed; Phase 5 plan §3.3).
 *
 * This is the shared entry point Phase 6's adaptive analyzer extends with
 * combo/pattern detection — the signature is designed to grow without
 * breaking the Dashboard (`selectWeakKeys(limit, minPresses)`).
 *
 * Threshold (plan §2): a key needs `minPresses` total samples before it can
 * be called weak — one-off typos must not masquerade as weakness. Ordering:
 * lowest accuracy first (ties: more misses first), computed by SQL.
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
  return rows.map((row) => ({
    key: row.key,
    shiftRequired: row.shiftRequired,
    accuracy: row.totalPresses > 0
      ? (row.correctPresses / row.totalPresses) * 100
      : 0,
    presses: row.totalPresses,
    misses: row.incorrectPresses,
  }));
}
