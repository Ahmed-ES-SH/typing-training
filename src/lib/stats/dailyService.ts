import { attemptsRepo, progressRepo, sessionsRepo, settingsRepo } from "../db/repositories";
import { dailyGoalsRepo, type DailyGoalValues } from "./dailyGoalsRepo";

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

/* ---------------------------------------------------------------------------
 * Phase 8 — goal progress + consistency (§18)
 *
 * Completion semantics (plan §2): a day's goals are "met" when ALL ENABLED
 * goals for that day are reached (target 0 = disabled, excluded from the
 * calculation). Partial progress is always visible; meeting goals renders a
 * subtle filled + check state, never a modal.
 * ------------------------------------------------------------------------- */

/** Progress of one goal: 0-target goals are `disabled` and excluded. */
export interface GoalProgress {
  target: number;
  actual: number;
  /** 0–100+ (uncapped so over-achievement is visible). */
  pct: number;
  met: boolean;
  disabled: boolean;
}

function toGoalProgress(target: number, actual: number): GoalProgress {
  if (!(target > 0)) return { target, actual, pct: 0, met: false, disabled: true };
  return {
    target,
    actual,
    pct: (actual / target) * 100,
    met: actual >= target,
    disabled: false,
  };
}

export interface TodayProgress {
  goals: DailyGoalValues;
  minutes: GoalProgress;
  lessons: GoalProgress;
  chars: GoalProgress;
  /** Enabled goal count / met count for the "2 of 3" read-out. */
  enabledCount: number;
  metCount: number;
  /**
   * True when every ENABLED goal is reached. False when nothing is enabled
   * (there is nothing to celebrate) and when training hasn't met them yet.
   */
  metAll: boolean;
}

/** Merges a goal set with actuals into per-goal progress (pure). */
export function mergeProgress(goals: DailyGoalValues, actuals: DailyActuals): TodayProgress {
  const minutes = toGoalProgress(goals.minutesGoal, actuals.minutes);
  const lessons = toGoalProgress(goals.lessonsGoal, actuals.lessonsDone);
  const chars = toGoalProgress(goals.charsGoal, actuals.charsTyped);
  const enabled = [minutes, lessons, chars].filter((g) => !g.disabled);
  const metCount = enabled.filter((g) => g.met).length;
  return {
    goals,
    minutes,
    lessons,
    chars,
    enabledCount: enabled.length,
    metCount,
    metAll: enabled.length > 0 && metCount === enabled.length,
  };
}

/** Today's goals × today's actuals → per-goal progress + met-all flag. */
export async function todayProgress(now = Date.now()): Promise<TodayProgress> {
  const [goals, actuals] = await Promise.all([
    dailyGoalsRepo.resolveForDate(localDayKey(now)),
    getTodayActuals(now),
  ]);
  return mergeProgress(goals, actuals);
}

/** Whether all of today's ENABLED goals are currently met. */
export async function metAllToday(now = Date.now()): Promise<boolean> {
  return (await todayProgress(now)).metAll;
}

/**
 * Membership + start of the CURRENT activity-streak run: walks back from
 * today, else yesterday. Driven by ACTIVITY days, not goal results — a
 * goal-miss never breaks this walk (plan §2 streak rule).
 */
function currentStreakRun(
  activeDays: string[],
  todayKey: string,
): { run: Set<string>; start: string | null } {
  const active = new Set(activeDays);
  const run = new Set<string>();
  let cursor = todayKey;
  if (!active.has(cursor)) {
    const yesterday = localDayKey(
      new Date(`${todayKey}T12:00:00`).getTime() - 86_400_000,
    );
    if (!active.has(yesterday)) return { run, start: null };
    cursor = yesterday;
  }
  let cursorMs = new Date(`${cursor}T12:00:00`).getTime();
  for (;;) {
    const key = localDayKey(cursorMs);
    if (!active.has(key)) break;
    run.add(key);
    cursorMs -= 86_400_000;
  }
  return { run, start: [...run].sort()[0] ?? null };
}

/** Consistency cell state (plan §3.3): one marker per day. */
export type DayStatus = "met" | "partial" | "missed" | "inactive";

export interface DayConsistency {
  /** Local calendar key ("YYYY-MM-DD"). */
  date: string;
  minutes: number;
  lessons: number;
  chars: number;
  status: DayStatus;
  enabledGoals: number;
  metGoals: number;
  /** 1-based position inside the CURRENT streak run, or null outside it. */
  streakDay: number | null;
}

/**
 * Last `days` calendar days ending today (oldest first): per-day minutes /
 * lessons / chars from the same sources as the goals panel
 * (`training_sessions` + `lesson_progress`), so the strip reconciles with
 * `todayProgress` exactly, evaluated against each date's own resolved goals
 * (per-date overrides apply historically too).
 *
 * Status rule: no activity → `inactive`; activity with 0 enabled goals met
 * → `missed` (a goal-miss never breaks the streak — only inactivity does);
 * some but not all → `partial`; all enabled → `met`. A day with activity
 * and zero enabled goals counts as `met` (nothing left to meet).
 */
export async function getConsistency(
  days = 14,
  now = Date.now(),
): Promise<DayConsistency[]> {
  const safeDays = Math.max(1, Math.min(366, Math.floor(days)));
  const todayKey = localDayKey(now);
  const dates: string[] = [];
  {
    const noon = new Date(now);
    noon.setHours(12, 0, 0, 0);
    for (let offset = safeDays - 1; offset >= 0; offset--) {
      dates.push(localDayKey(noon.getTime() - offset * 86_400_000));
    }
  }
  const windowStart = startOfLocalDay(
    new Date(`${dates[0]}T12:00:00`).getTime(),
  );

  const [sessionDays, lessonDays, activeDays, defaults, overrides] = await Promise.all([
    sessionsRepo.totalsByDay(windowStart),
    progressRepo.completedByDay(windowStart),
    attemptsRepo.distinctActiveDays(),
    // One batched goal read for the whole strip (no per-date queries):
    // per-date overrides resolved in memory over the defaults.
    dailyGoalsRepo.getDefaults(),
    dailyGoalsRepo.allOverrides(),
  ]);
  const overrideByDate = new Map(overrides.map((o) => [o.date, o]));

  const sessionByDay = new Map(sessionDays.map((r) => [r.day, r]));
  const lessonsByDay = new Map(lessonDays.map((r) => [r.day, r.count]));
  const { run: streakRun, start: streakStart } = currentStreakRun(activeDays, todayKey);
  const streakDayOf = (date: string): number | null => {
    if (streakStart === null || !streakRun.has(date)) return null;
    return (
      Math.round(
        (new Date(`${date}T12:00:00`).getTime() -
          new Date(`${streakStart}T12:00:00`).getTime()) /
          86_400_000,
      ) + 1
    );
  };

  const cells: DayConsistency[] = [];
  for (const date of dates) {
    const session = sessionByDay.get(date);
    const minutes = (session?.durationMs ?? 0) / 60_000;
    const chars = session?.chars ?? 0;
    const lessons = lessonsByDay.get(date) ?? 0;
    const goals: DailyGoalValues = overrideByDate.get(date) ?? defaults;
    const merged = mergeProgress(goals, {
      minutes,
      lessonsDone: lessons,
      charsTyped: chars,
    });
    const activeDay = minutes > 0 || lessons > 0 || chars > 0;
    let status: DayStatus;
    if (!activeDay) status = "inactive";
    else if (merged.enabledCount === 0) status = "met";
    else if (merged.metCount === merged.enabledCount) status = "met";
    else if (merged.metCount === 0) status = "missed";
    else status = "partial";
    cells.push({
      date,
      minutes,
      lessons,
      chars,
      status,
      enabledGoals: merged.enabledCount,
      metGoals: merged.metCount,
      streakDay: streakDayOf(date),
    });
  }
  return cells;
}
