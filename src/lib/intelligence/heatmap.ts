import { findKey, type KeyboardLayout } from "../layout";
import { keyStatsRepo } from "../db/repositories";

/**
 * Key Heatmap mapping (PRD §14; Phase 6 plan §3.5).
 *
 * Pure layer: per-character stats in, per-physical-key heat cells out. Each
 * cell is colored by WEIGHTED accuracy across every char typed on it (base +
 * shift variants — `[` and `{` both land on the `[` key); per-char splits
 * ride along for tooltips. Buckets are the statistics design's exact legend:
 *   < 85% weak · 85–93% · 93–97% · >= 97% strong · no data
 */

export type HeatBucket = "weak" | "below" | "avg" | "strong" | "nodata";

/** Exact palette from `screens/statistics_typekernel` (plan §2). */
export const HEAT_BG: Record<HeatBucket, string> = {
  weak: "#4a1d06",
  below: "#9d4300",
  avg: "#d97722",
  strong: "#ffb783",
  nodata: "#262a34",
};

/** Readable on-label text colors from the same design. */
export const HEAT_TEXT: Record<HeatBucket, string> = {
  weak: "#ffdad6",
  below: "#ffdbca",
  avg: "#301400",
  strong: "#301400",
  nodata: "#a78b7d",
};

export const BUCKET_LABELS: { bucket: HeatBucket; label: string }[] = [
  { bucket: "weak", label: "<85% weak" },
  { bucket: "below", label: "85–93%" },
  { bucket: "avg", label: "93–97%" },
  { bucket: "strong", label: "≥97% strong" },
  { bucket: "nodata", label: "no data" },
];

/** Per-character accuracy input (one row per char + shift variant). */
export interface CharAccuracy {
  char: string;
  shiftRequired: boolean;
  presses: number;
  correct: number;
  /** Lifetime average latency when known (daily rollups don't carry it). */
  avgLatencyMs?: number;
}

/** Per-char split of one heat cell (tooltip). */
export interface CellChar {
  char: string;
  shiftRequired: boolean;
  accuracy: number;
  presses: number;
  avgLatencyMs: number | null;
}

/** One physical key's heat. */
export interface HeatCell {
  keyId: string;
  /** Display label (letters upper-cased per the design). */
  label: string;
  kind: "char" | "special";
  /** Weighted accuracy across all chars on the key; null = no data. */
  accuracy: number | null;
  bucket: HeatBucket;
  /** Total misses across the key's chars (Frequently Incorrect card). */
  misses: number;
  /** Press-weighted average latency (Slowest card); null when unknown. */
  avgLatencyMs: number | null;
  chars: CellChar[];
}

/** Bucket edges (§2): <85 weak, <93 below, <97 avg, else strong. */
export function bucketFor(accuracy: number): HeatBucket {
  if (accuracy < 85) return "weak";
  if (accuracy < 93) return "below";
  if (accuracy < 97) return "avg";
  return "strong";
}

const labelFor = (base: string): string =>
  base.length === 1 && base >= "a" && base <= "z" ? base.toUpperCase() : base;

/**
 * Maps per-char stats onto the layout's physical keys. Chars that resolve to
 * no key (e.g. "\n") are ignored; keys with no data stay "nodata".
 */
export function buildHeatmapCells(
  layout: KeyboardLayout,
  stats: CharAccuracy[],
): HeatCell[] {
  // Merge chars onto their physical key first.
  interface KeyMerge {
    presses: number;
    correct: number;
    latencySum: number;
    latencyKnown: number;
    chars: CellChar[];
  }
  const byKey = new Map<string, KeyMerge>();

  for (const stat of stats) {
    if (stat.presses <= 0) continue;
    const target = findKey(layout, stat.char);
    if (target === null) continue; // unmapped char (e.g. newline)
    const merge = byKey.get(target.key.id) ?? {
      presses: 0,
      correct: 0,
      latencySum: 0,
      latencyKnown: 0,
      chars: [],
    };
    merge.presses += stat.presses;
    merge.correct += stat.correct;
    if (stat.avgLatencyMs !== undefined) {
      merge.latencySum += stat.avgLatencyMs * stat.presses;
      merge.latencyKnown += stat.presses;
    }
    merge.chars.push({
      char: stat.char,
      shiftRequired: stat.shiftRequired,
      accuracy: (stat.correct / stat.presses) * 100,
      presses: stat.presses,
      avgLatencyMs: stat.avgLatencyMs ?? null,
    });
    byKey.set(target.key.id, merge);
  }

  return layout.rows.flat().map((key) => {
    if (key.kind === "special") {
      return {
        keyId: key.id,
        label: key.label ?? "",
        kind: "special" as const,
        accuracy: null,
        bucket: "nodata" as HeatBucket,
        misses: 0,
        avgLatencyMs: null,
        chars: [],
      };
    }
    const merge = byKey.get(key.id);
    if (merge === undefined || merge.presses === 0) {
      return {
        keyId: key.id,
        label: labelFor(key.base),
        kind: "char" as const,
        accuracy: null,
        bucket: "nodata" as HeatBucket,
        misses: 0,
        avgLatencyMs: null,
        chars: [],
      };
    }
    const accuracy = (merge.correct / merge.presses) * 100;
    return {
      keyId: key.id,
      label: labelFor(key.base),
      kind: "char" as const,
      accuracy,
      bucket: bucketFor(accuracy),
      misses: merge.presses - merge.correct,
      avgLatencyMs: merge.latencyKnown > 0 ? merge.latencySum / merge.latencyKnown : null,
      chars: merge.chars.sort((a, b) => a.char.localeCompare(b.char)),
    };
  });
}

/* ------------------------------ data loading ---------------------------- */

/** Loads per-char accuracies for a window. 30d/90d read the daily rollups
 * and fall back to lifetime `key_statistics` for chars they do not cover yet
 * (plan §2); "lifetime" reads the lifetime aggregates directly. */
export async function getCharAccuracy(
  window: "30d" | "90d" | "lifetime",
  now = Date.now(),
  dayBefore: (ts: number, days: number) => string = defaultDayBefore,
): Promise<CharAccuracy[]> {
  if (window === "lifetime") {
    return (await keyStatsRepo.all()).map((row) => ({
      char: row.key,
      shiftRequired: row.shiftRequired,
      presses: row.totalPresses,
      correct: row.correctPresses,
      avgLatencyMs: row.avgLatencyMs,
    }));
  }
  const sinceDay = dayBefore(now, window === "30d" ? 30 : 90);
  const [daily, lifetime] = await Promise.all([
    keyStatsRepo.dailySince(sinceDay),
    keyStatsRepo.all(),
  ]);
  const covered = new Set(
    daily.map((row) => `${row.key}\u0000${row.shiftRequired ? "1" : "0"}`),
  );
  const merged = new Map<string, CharAccuracy>();
  for (const row of daily) {
    const id = `${row.key}\u0000${row.shiftRequired ? "1" : "0"}`;
    const acc = merged.get(id) ?? {
      char: row.key,
      shiftRequired: row.shiftRequired,
      presses: 0,
      correct: 0,
    };
    acc.presses += row.presses;
    acc.correct += row.correct;
    merged.set(id, acc);
  }
  for (const row of lifetime) {
    const id = `${row.key}\u0000${row.shiftRequired ? "1" : "0"}`;
    if (covered.has(id)) continue;
    merged.set(id, {
      char: row.key,
      shiftRequired: row.shiftRequired,
      presses: row.totalPresses,
      correct: row.correctPresses,
      avgLatencyMs: row.avgLatencyMs,
    });
  }
  return [...merged.values()];
}

function defaultDayBefore(ts: number, days: number): string {
  // Local calendar key of `days` ago (mirrors analyzer.dayKeyBefore).
  const d = new Date(ts - days * 86_400_000);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
