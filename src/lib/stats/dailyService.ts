import { attemptsRepo, progressRepo, sessionsRepo, settingsRepo } from "../db/repositories";

/**
 * Daily training service (PRD §18 read-outs; Phase 5 plan §3.2).
 *
 * Streak definition (plan §2): consecutive LOCAL calendar days with at least
 * one completed attempt. The streak may end on today OR yesterday — having
 * not typed yet today does not break an active streak.
 *
 * Local-timezone day boundaries: the app is a single-user Linux desktop
 * application (documented plan assumption), so "day" = the OS local timezone.
 * Day keys come from SQLite's `date(..., 'localtime')` so the aggregation
 * stays inside the database engine.
 *
 * The best streak is persisted in `settings` under `best_streak` (§20).
 */

export const BEST_STREAK_KEY = "best_streak";

/** §18 defaults shown on the Dashboard goals panel until Phase 8 adds editing. */
export const DEFAULT_DAILY_GOALS = {
  minutesGoal: 15,
  lessonsGoal: 3,
  charsGoal: 500,
} as const;

/** Local calendar date key ("YYYY-MM-DD") for an epoch-ms timestamp. */
export function localDayKey(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight of the day containing `ts` (epoch ms). */
export function startOfLocalDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Pure streak walk over sorted distinct day keys ("YYYY-MM-DD").
 * `todayKey` anchors the current-streak walk: count back from today, or from
 * yesterday when today itself is inactive. The best run is the longest
 * consecutive streak anywhere in the list (it may predate the current one).
 */
export function computeStreak(
  days: string[],
  todayKey: string,
): { current: number; bestRun: number } {
  const active = new Set(days);
  const isDayActive = (key: string) => active.has(key);

  // Longest consecutive run anywhere in the day list.
  let bestRun = 0;
  let run = 0;
  let previousMs: number | null = null;
  for (const day of [...days].sort()) {
    const dayMs = new Date(`${day}T12:00:00`).getTime();
    run = previousMs !== null && dayMs - previousMs === 86_400_000 ? run + 1 : 1;
    bestRun = Math.max(bestRun, run);
    previousMs = dayMs;
  }

  // Current streak: walks backward from today (or yesterday).
  let cursor = todayKey;
  if (!isDayActive(cursor)) {
    const yesterday = localDayKey(new Date(`${todayKey}T12:00:00`).getTime() - 86_400_000);
    if (!isDayActive(yesterday)) return { current: 0, bestRun };
    cursor = yesterday;
  }

  let current = 0;
  let cursorMs = new Date(`${cursor}T12:00:00`).getTime();
  while (isDayActive(localDayKey(cursorMs))) {
    current += 1;
    cursorMs -= 86_400_000;
  }
  return { current, bestRun: Math.max(bestRun, current) };
}

export interface StreakInfo {
  current: number;
  best: number;
}

/**
 * Current + best streak. Distinct active days come from one DISTINCT query
 * over the attempt ledger (completed attempts only); the best streak is
 * persisted and raised in the same call when the current run beats it.
 */
export async function getStreak(now = Date.now()): Promise<StreakInfo> {
  const activeDays = await attemptsRepo.distinctActiveDays();
  const { current, bestRun } = computeStreak(activeDays, localDayKey(now));

  const stored = await settingsRepo.get(BEST_STREAK_KEY);
  const best = Math.max(current, bestRun, typeof stored === "number" ? stored : 0);
  if (best !== stored) {
    await settingsRepo.set(BEST_STREAK_KEY, best, now);
  }
  return { current, best };
}

export interface DailyActuals {
  /** Minutes trained today (from training_sessions). */
  minutes: number;
  lessonsDone: number;
  charsTyped: number;
}

/** Today's actuals against the seeded goal defaults (display-only, §2). */
export async function getTodayActuals(now = Date.now()): Promise<DailyActuals> {
  const dayStart = startOfLocalDay(now);
  const [sessionTotals, lessonsDone] = await Promise.all([
    sessionsRepo.totalsSince(dayStart),
    progressRepo.countCompletedSince(dayStart),
  ]);
  return {
    minutes: sessionTotals.durationMs / 60_000,
    lessonsDone,
    charsTyped: sessionTotals.chars,
  };
}
