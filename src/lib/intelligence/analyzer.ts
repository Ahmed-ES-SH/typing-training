import {
  attemptsRepo,
  bigramStatsRepo,
  keyStatsRepo,
  settingsRepo,
} from "../db/repositories";
import {
  QueueEntrySchema,
  type BigramStatRow,
  type KeyReportEntry,
  type KeyStatDailyRow,
  type KeyStatRow,
  type QueueEntry,
  type WeakKeyState,
} from "../schemas";
import { localDayKey } from "../stats/dailyService";

/**
 * Weakness analyzer (PRD §13/§15/§26; Phase 6 plan §3.2).
 *
 * Pure decision core (`computeQueue`, `windowAccuracy`, `consecutiveDaysAt`)
 * + one async orchestrator (`analyzeWeaknesses`) that reads the rollup
 * tables, applies the lifecycle thresholds and persists the queue state to
 * `settings` (§20 — no new table). Runs on navigation, never per keystroke.
 *
 * Lifecycle (plan §2 — deterministic, testable thresholds):
 *   targeted    accuracy < 90% over the rolling 30-day window (min presses)
 *   maintenance accuracy >= 90% for 7 consecutive active days
 *   eliminated  accuracy >= 95% for 7 consecutive active days
 * Max 6 concurrent targeted keys; priorities = worst accuracy first.
 *
 * "7 consecutive days" means 7 consecutive days WITH typing activity
 * (presses >= 1): idle gaps neither progress nor reset the streak, they
 * just pause it. This keeps the rule meaningful for once-a-day trainees.
 */

export const WEAKNESS_QUEUE_KEY = "weakness_queue";

/** Rolling analysis window (§15 "rolling 30-day"). */
export const WINDOW_DAYS = 30;
/** A char needs this many presses in the window before it can be judged. */
export const MIN_PRESSES = 30;
/** Below this 30-day accuracy a char is (re-)targeted. */
export const TARGET_THRESHOLD = 90;
/** Maintenance: at/above this accuracy for STATE_DAYS active days. */
export const MAINTENANCE_THRESHOLD = 90;
/** Elimination: at/above this accuracy for STATE_DAYS active days. */
export const ELIMINATED_THRESHOLD = 95;
/** Consecutive active days required for a state transition. */
export const STATE_DAYS = 7;
/** Max concurrently targeted keys (§15 queue cap). */
export const MAX_TARGETED = 6;
/** A bigram needs this many planned occurrences to be ranked as a combo. */
export const MIN_BIGRAM_TOTAL = 10;

export interface DayAccuracy {
  day: string;
  presses: number;
  correct: number;
}

/** Per-char daily series (the analyzer's input). */
export interface CharSeries {
  key: string;
  shiftRequired: boolean;
  rows: DayAccuracy[];
}

export interface WeaknessTarget {
  key: string;
  shiftRequired: boolean;
  /** Rolling-30d (or lifetime fallback) accuracy, 0-100. */
  accuracy: number;
  presses: number;
  misses: number;
  state: WeakKeyState;
  /** 1-based rank among TARGETED keys (worst accuracy first); null otherwise. */
  priority: number | null;
  /** Local day key the current state was reached. */
  stateSince: string;
}

export interface WeakCombo {
  pair: string;
  errorRate: number;
  total: number;
}

export interface ErrorPattern {
  key: string;
  shiftRequired: boolean;
  /** Misses of this char across the last attempts' key reports. */
  misses: number;
}

export interface WeaknessAnalysis {
  targets: WeaknessTarget[];
  combos: WeakCombo[];
  patterns: ErrorPattern[];
  /** Lifetime slowest chars (min presses) — heatmap "slowest" card. */
  slowest: { key: string; shiftRequired: boolean; avgLatencyMs: number; presses: number }[];
  /** True when there is no analysable data at all (empty-state hint). */
  empty: boolean;
}

/* --------------------------- pure helpers ------------------------------ */

/** Day key `days` before `now` (local calendar). */
export function dayKeyBefore(now: number, days: number): string {
  return localDayKey(now - days * 86_400_000);
}

/** Window accuracy of a series, or null when under `minPresses` samples. */
export function windowAccuracy(
  rows: DayAccuracy[],
  minPresses = MIN_PRESSES,
): { accuracy: number; presses: number; misses: number } | null {
  let presses = 0;
  let correct = 0;
  for (const row of rows) {
    presses += row.presses;
    correct += row.correct;
  }
  if (presses < minPresses) return null;
  return {
    accuracy: (correct / presses) * 100,
    presses,
    misses: presses - correct,
  };
}

/** Day-key comparison (lexicographic works for ISO dates). */
const byDay = (a: DayAccuracy, b: DayAccuracy) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);

/**
 * Length of the trailing run of consecutive ACTIVE days (each active day's
 * accuracy must be >= `minAccuracy`). Idle calendar gaps do not break the
 * run — they are simply not days. Input order does not matter.
 */
export function consecutiveDaysAt(
  inputRows: DayAccuracy[],
  minAccuracy: number,
): number {
  const rows = [...inputRows].sort(byDay);
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.presses < 1) continue; // defensive: daily rows always have >= 1
    if ((row.correct / row.presses) * 100 < minAccuracy) break;
    streak += 1;
  }
  return streak;
}

/** Day key where a trailing streak of `streak` active days started. */
function streakStartDay(inputRows: DayAccuracy[], streak: number): string {
  const rows = [...inputRows].sort(byDay);
  const index = Math.max(0, rows.length - streak);
  return rows[index]?.day ?? localDayKey(Date.now());
}

/**
 * The queue lifecycle — pure. `previous` carries persisted state across
 * analyses; the output is the full new queue (targeted first, worst
 * accuracy first). Chars under the min-press threshold keep their previous
 * entry (insufficient data must not silently graduate a key).
 */
export function computeQueue(
  series: CharSeries[],
  previous: QueueEntry[],
  todayKey: string,
): QueueEntry[] {
  const prevByKey = new Map(
    previous.map((entry) => [`${entry.key}\u0000${entry.shiftRequired ? "1" : "0"}`, entry]),
  );

  interface Candidate {
    entry: QueueEntry;
    accuracy: number;
  }
  const candidates: Candidate[] = [];

  for (const char of series) {
    const id = `${char.key}\u0000${char.shiftRequired ? "1" : "0"}`;
    const prev = prevByKey.get(id);
    const window = windowAccuracy(char.rows);

    if (window === null) {
      // Not enough data: keep the previous state verbatim, never invent one.
      if (prev) candidates.push({ entry: prev, accuracy: 0 });
      continue;
    }

    let entry: QueueEntry;
    if (window.accuracy < TARGET_THRESHOLD) {
      // Weak again (or still weak): targeted. stateSince stays anchored at
      // the original targeting day while the key remains targeted.
      entry =
        prev?.state === "targeted"
          ? prev
          : { key: char.key, shiftRequired: char.shiftRequired, state: "targeted", stateSince: todayKey };
    } else if (prev === undefined) {
      // Healthy and never targeted — it has nothing to graduate from; the
      // queue only tracks chars that were (or are) weaknesses.
      continue;
    } else {
      const maintStreak = consecutiveDaysAt(char.rows, MAINTENANCE_THRESHOLD);
      const elimStreak = consecutiveDaysAt(char.rows, ELIMINATED_THRESHOLD);
      if (elimStreak >= STATE_DAYS) {
        entry =
          prev.state === "eliminated"
            ? prev
            : {
                key: char.key,
                shiftRequired: char.shiftRequired,
                state: "eliminated",
                stateSince: streakStartDay(char.rows, elimStreak),
              };
      } else if (maintStreak >= STATE_DAYS) {
        entry =
          prev.state === "maintenance"
            ? prev
            : {
                key: char.key,
                shiftRequired: char.shiftRequired,
                state: "maintenance",
                stateSince: streakStartDay(char.rows, maintStreak),
              };
      } else {
        // Above target but the 7-day run is not complete yet: hold the
        // previous state (targeted stays targeted until it earns a bump).
        entry = prev;
      }
    }
    candidates.push({ entry, accuracy: window.accuracy });
  }

  // Queue cap: only the MAX_TARGETED worst-accuracy targeted keys stay
  // targeted; overflow targeted keys are dropped (they re-enter next
  // analysis when their accuracy warrants it).
  const targeted = candidates
    .filter((c) => c.entry.state === "targeted")
    .sort((a, b) => a.accuracy - b.accuracy);
  const overflowIds = new Set(
    targeted.slice(MAX_TARGETED).map((c) => `${c.entry.key}\u0000${c.entry.shiftRequired ? "1" : "0"}`),
  );

  return candidates
    .filter((c) => !overflowIds.has(`${c.entry.key}\u0000${c.entry.shiftRequired ? "1" : "0"}`))
    .map((c) => QueueEntrySchema.parse(c.entry));
}

/* ------------------------------ inputs --------------------------------- */

/** Groups daily rollup rows into per-char series (sorted by day). */
export function groupDailyRows(rows: KeyStatDailyRow[]): CharSeries[] {
  const map = new Map<string, CharSeries>();
  for (const row of rows) {
    const id = `${row.key}\u0000${row.shiftRequired ? "1" : "0"}`;
    const series = map.get(id) ?? {
      key: row.key,
      shiftRequired: row.shiftRequired,
      rows: [],
    };
    series.rows.push({ day: row.date, presses: row.presses, correct: row.correct });
    map.set(id, series);
  }
  for (const series of map.values()) {
    series.rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }
  return [...map.values()];
}

/**
 * Lifetime fallback (plan §2): chars whose daily coverage has not started
 * yet contribute a single synthetic "day" built from their lifetime totals,
 * so a fresh install still produces a queue from the first finish.
 */
export function lifetimeFallbackSeries(
  lifetime: KeyStatRow[],
  covered: Set<string>,
  todayKey: string,
): CharSeries[] {
  const series: CharSeries[] = [];
  for (const row of lifetime) {
    const id = `${row.key}\u0000${row.shiftRequired ? "1" : "0"}`;
    if (covered.has(id) || row.totalPresses === 0) continue;
    series.push({
      key: row.key,
      shiftRequired: row.shiftRequired,
      rows: [
        {
          day: todayKey,
          presses: row.totalPresses,
          correct: row.correctPresses,
        },
      ],
    });
  }
  return series;
}

/** Aggregates per-char misses from the last attempts' key reports. */
export function patternsFromReports(
  reports: (KeyReportEntry[] | null)[],
  minMisses = 3,
): ErrorPattern[] {
  const totals = new Map<string, ErrorPattern>();
  for (const report of reports) {
    if (!report) continue;
    for (const entry of report) {
      if (entry.incorrectPresses === 0) continue;
      const id = `${entry.key}\u0000${entry.shiftRequired ? "1" : "0"}`;
      const pattern = totals.get(id) ?? {
        key: entry.key,
        shiftRequired: entry.shiftRequired,
        misses: 0,
      };
      pattern.misses += entry.incorrectPresses;
      totals.set(id, pattern);
    }
  }
  return [...totals.values()]
    .filter((p) => p.misses >= minMisses)
    .sort((a, b) => b.misses - a.misses);
}

/** Ranks bigram rows into combos (worst error rate first). */
export function rankCombos(
  rows: BigramStatRow[],
  minTotal = MIN_BIGRAM_TOTAL,
  limit = 8,
): WeakCombo[] {
  return rows
    .filter((row) => row.total >= minTotal)
    .map((row) => ({
      pair: row.pair,
      total: row.total,
      errorRate: (row.incorrect / row.total) * 100,
    }))
    .sort((a, b) => b.errorRate - a.errorRate || b.total - a.total)
    .slice(0, limit);
}

/* --------------------------- orchestrator ------------------------------ */

async function loadQueue(): Promise<QueueEntry[]> {
  const raw = await settingsRepo.get(WEAKNESS_QUEUE_KEY);
  if (!Array.isArray(raw)) return [];
  const entries: QueueEntry[] = [];
  for (const item of raw) {
    const parsed = QueueEntrySchema.safeParse(item);
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}

/**
 * Runs the full analysis against the rollup tables and (re)persists the
 * queue state when it changed. This is the single input for the heatmap
 * cards, the adaptive generator and the drill composer.
 */
export async function analyzeWeaknesses(now = Date.now()): Promise<WeaknessAnalysis> {
  const todayKey = localDayKey(now);
  const sinceDay = dayKeyBefore(now, WINDOW_DAYS);
  const [daily, lifetime, bigrams, reports] = await Promise.all([
    keyStatsRepo.dailySince(sinceDay),
    keyStatsRepo.all(),
    bigramStatsRepo.all(1),
    attemptsRepo.recentKeyReports(10),
  ]);

  const covered = new Set(daily.map((row) => `${row.key}\u0000${row.shiftRequired ? "1" : "0"}`));
  const series = [
    ...groupDailyRows(daily),
    ...lifetimeFallbackSeries(lifetime, covered, todayKey),
  ];

  const previous = await loadQueue();
  const queue = computeQueue(series, previous, todayKey);

  // Persist only on change (analyze runs on every navigation).
  if (JSON.stringify(queue) !== JSON.stringify(previous)) {
    await settingsRepo.set(WEAKNESS_QUEUE_KEY, queue, now);
  }

  const accuracyByKey = new Map<string, { accuracy: number; presses: number; misses: number }>();
  for (const char of series) {
    const window = windowAccuracy(char.rows);
    if (window) {
      accuracyByKey.set(`${char.key}\u0000${char.shiftRequired ? "1" : "0"}`, window);
    }
  }

  // Targeted keys: worst accuracy first, priority 1..n (the design's cards).
  const targetedSorted = queue
    .filter((entry) => entry.state === "targeted")
    .map((entry) => ({
      entry,
      window: accuracyByKey.get(`${entry.key}\u0000${entry.shiftRequired ? "1" : "0"}`),
    }))
    .sort((a, b) => (a.window?.accuracy ?? 100) - (b.window?.accuracy ?? 100));

  const targets: WeaknessTarget[] = targetedSorted.map(({ entry, window }, index) => ({
    key: entry.key,
    shiftRequired: entry.shiftRequired,
    accuracy: window?.accuracy ?? 0,
    presses: window?.presses ?? 0,
    misses: window?.misses ?? 0,
    state: entry.state,
    priority: index + 1,
    stateSince: entry.stateSince,
  }));
  for (const entry of queue) {
    if (entry.state === "targeted") continue;
    const window = accuracyByKey.get(`${entry.key}\u0000${entry.shiftRequired ? "1" : "0"}`);
    targets.push({
      key: entry.key,
      shiftRequired: entry.shiftRequired,
      accuracy: window?.accuracy ?? 0,
      presses: window?.presses ?? 0,
      misses: window?.misses ?? 0,
      state: entry.state,
      priority: null,
      stateSince: entry.stateSince,
    });
  }

  const slowest = lifetime
    .filter((row) => row.totalPresses >= 20)
    .map((row) => ({
      key: row.key,
      shiftRequired: row.shiftRequired,
      avgLatencyMs: row.avgLatencyMs,
      presses: row.totalPresses,
    }))
    .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
    .slice(0, 6);

  return {
    targets,
    combos: rankCombos(bigrams),
    patterns: patternsFromReports(reports),
    slowest,
    empty: series.length === 0 && bigrams.length === 0,
  };
}

/** The chars the drill should focus on (targeted first, max 3 — design). */
export function focusKeysOf(analysis: WeaknessAnalysis, max = 3): WeaknessTarget[] {
  return analysis.targets
    .filter((t) => t.state === "targeted" || t.state === "maintenance")
    .slice(0, max);
}

/* --------------------------- recovery curves ---------------------------- */

export interface RecoveryProjection {
  /** Least-squares slope of daily accuracy (%/day; negative = declining). */
  slopePerDay: number;
  /** Latest window accuracy (%). */
  current: number;
  /** Display-only projection 7 days ahead at the fitted slope. */
  projected: number;
  /** Days until the projection reaches 95% (elimination), null if never. */
  etaDays: number | null;
}

/**
 * Linear regression on the per-day accuracies (display-only estimates for
 * the design's "improving +1.2%/day — elimination ETA 9 days" rows).
 *
 * `currentOverride` anchors the projection at the SAME rolling-30d accuracy
 * the queue cards display (plan §2: one source of truth per number) instead
 * of the last single day, which would contradict the queue card.
 */
export function projectRecovery(
  rows: DayAccuracy[],
  currentOverride?: number,
): RecoveryProjection {
  const points = rows
    .filter((r) => r.presses >= 1)
    .map((r) => (r.correct / r.presses) * 100);
  const current = currentOverride ?? (points.length > 0 ? points[points.length - 1] : 0);
  if (points.length < 2) {
    return { slopePerDay: 0, current, projected: current, etaDays: null };
  }
  const n = points.length;
  const meanX = (n - 1) / 2;
  const meanY = points.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (points[i] - meanY);
    den += (i - meanX) * (i - meanX);
  }
  const slopePerDay = den === 0 ? 0 : num / den;
  const projected = Math.max(0, Math.min(100, current + slopePerDay * 7));
  let etaDays: number | null = null;
  if (slopePerDay > 0 && current < ELIMINATED_THRESHOLD) {
    etaDays = Math.ceil((ELIMINATED_THRESHOLD - current) / slopePerDay);
  }
  return { slopePerDay, current, projected, etaDays };
}

/**
 * Maps analyzer targets onto the Phase 5 `WeakKey` shape, sorted
 * worst-accuracy-first — the single data source for the Dashboard's drill
 * card chips and Weak Keys Radar (plan §3.7: one live queue, no divergent
 * lifetime selector).
 */
export function targetsToWeakKeys(
  analysis: WeaknessAnalysis,
): { key: string; shiftRequired: boolean; accuracy: number; presses: number; misses: number }[] {
  return analysis.targets
    .map((t) => ({
      key: t.key,
      shiftRequired: t.shiftRequired,
      accuracy: t.accuracy,
      presses: t.presses,
      misses: t.misses,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);
}
