/**
 * Shared formatting — the single number/time formatter for the app
 * (Phase 8 plan §3.5 "Formatting").
 *
 * New code imports from here (`src/lib/format`). The long-standing
 * `src/lib/stats/format.ts` implementations are re-exported below (plus new
 * helpers), so both paths expose the identical, NaN-safe formatter set and
 * no screen formats numbers ad hoc anymore.
 */

export * from "./stats/format";

/** Percentage with one decimal ("93.5%") — NaN-safe. */
export function fmtPct(value: number | null | undefined): string {
  return `${(Number.isFinite(value) ? (value as number) : 0).toFixed(1)}%`;
}

/** Clock "MM:SS" for session timers ("04:07"). */
export function fmtClock(ms: number | null | undefined): string {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
