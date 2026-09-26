import type { AttemptKind } from "../schemas";

/**
 * Daily Routine habit engine (UX plan §5.1 / §5.4) — the pure core behind
 * the Dashboard's "Daily Routine" card.
 *
 * The routine is a three-step recommendation (weakness warmup → push the
 * curriculum frontier → speed sprint). Progress is DERIVED from the
 * append-only attempt ledger: nothing is ever pushed into the DB, and a step
 * only turns `done` when a matching attempt FINISHED at or after the day's
 * routine start. Steps that cannot run in the current configuration are
 * `skipped` with a human reason, so a brand-new user (no weakness data, no
 * mastered lesson) still gets a runnable frontier step — and a routine where
 * every step is skipped still reaches `complete`, which hands Enter back to
 * the resume-frontier action.
 *
 * When the clock started persists in `localStorage` under a per-day key —
 * the injected-storage pattern of the micro-drill return hint, so every
 * helper runs in node tests. A key from an earlier day reads as absent,
 * which is what rolls the routine over at local midnight.
 *
 * Everything here is synchronous and dependency-injected;
 * `deriveRoutine` is the single decision function the Dashboard renders from
 * and the Enter handler dispatches through `dashboardEnterAction`.
 */

/* ------------------------------- step model ------------------------------ */

export type RoutineStepId = "warmup" | "frontier" | "sprint";

export type RoutineStepState = "done" | "skipped" | "pending";

export interface RoutineStep {
  id: RoutineStepId;
  title: string;
  detail: string;
  state: RoutineStepState;
  /** Why the step is skipped (only present on `skipped` steps). */
  skipReason?: string;
}

export interface RoutineStatus {
  /** Local calendar day ("YYYY-MM-DD") the routine belongs to. */
  dayKey: string;
  /** Epoch ms the routine was started, or null when it hasn't started. */
  startedAt: number | null;
  steps: RoutineStep[];
  /** True once no step is pending (done or skipped counts). */
  complete: boolean;
  /** First pending step, or null when nothing is left to do. */
  activeStepId: RoutineStepId | null;
}

/** The minimal attempt row the derivation consumes (finished attempts only). */
export interface RoutineAttempt {
  kind: AttemptKind;
  finishedAt: number;
  /** Curriculum lesson id — null for drill rows (`kind='weakness'`). */
  lessonId: string | null;
}

/** A `completed` lesson_progress row as the sprint picker consumes it. */
export interface MasteredLesson {
  id: string;
  bestWpm: number;
}

const STEP_ORDER: readonly RoutineStepId[] = ["warmup", "frontier", "sprint"];

const STEP_COPY: Record<RoutineStepId, { title: string; detail: string }> = {
  warmup: {
    title: "Weakness Warmup",
    detail: "60-second drill on your weakest keys.",
  },
  frontier: {
    title: "Push the Frontier",
    detail: "Two modules at the edge of your unlock.",
  },
  sprint: {
    title: "Speed Sprint",
    detail: "Your fastest mastered module, flat out.",
  },
};

const WARMUP_DISABLED_REASON = "Adaptive drills are off in Settings";
const WARMUP_EMPTY_REASON = "No weakness data yet";
const SPRINT_LOCKED_REASON = "Master a lesson to unlock speed sprints";

/* ------------------------------ derivation ------------------------------- */

export interface DeriveRoutineInput {
  startedAt: number | null;
  dayKey: string;
  /** Finished attempts (all kinds); rows before `startedAt` are ignored. */
  attemptsSinceStart: readonly RoutineAttempt[];
  adaptiveEnabled: boolean;
  analysisAvailable: boolean;
  completedLessonCount: number;
  sprintLessonId: string | null;
  masteredLessonIds: readonly string[];
}

/**
 * Pure state machine over one day's routine (UX plan §5.1):
 *
 * - `warmup` — skipped while adaptive drills are off or there is no weakness
 *   data yet; done on the first `kind='weakness'` attempt finished after the
 *   routine started.
 * - `frontier` — never skipped; done on TWO `kind='lesson'` attempts
 *   finished after the start (custom / weakness / adaptive rows don't count).
 * - `sprint` — skipped without a mastered lesson to sprint on; done on a
 *   `kind='lesson'` attempt against a mastered lesson after the start.
 *
 * Before the routine starts nothing can be `done` (the attempts clock has no
 * origin yet), but the skip rules still apply — they are independent of the
 * clock — so an unstarted routine still reports its first AVAILABLE step as
 * `activeStepId`. `complete` therefore requires `startedAt`, which keeps
 * `dashboardEnterAction` total: unstarted always means "start".
 */
export function deriveRoutine(input: DeriveRoutineInput): RoutineStatus {
  const { startedAt, dayKey } = input;
  const attempts =
    startedAt === null
      ? []
      : input.attemptsSinceStart.filter((attempt) => attempt.finishedAt >= startedAt);

  const warmupSkip =
    !input.adaptiveEnabled
      ? WARMUP_DISABLED_REASON
      : !input.analysisAvailable
        ? WARMUP_EMPTY_REASON
        : null;
  const sprintSkip =
    input.completedLessonCount === 0 || input.sprintLessonId === null
      ? SPRINT_LOCKED_REASON
      : null;

  const warmupDone = attempts.some((attempt) => attempt.kind === "weakness");
  const frontierDone =
    attempts.filter((attempt) => attempt.kind === "lesson").length >= 2;
  const mastered = new Set(input.masteredLessonIds);
  const sprintDone = attempts.some(
    (attempt) =>
      attempt.kind === "lesson" &&
      attempt.lessonId !== null &&
      mastered.has(attempt.lessonId),
  );

  const done: Record<RoutineStepId, boolean> = {
    warmup: warmupDone,
    frontier: frontierDone,
    sprint: sprintDone,
  };
  const skip: Record<RoutineStepId, string | null> = {
    warmup: warmupSkip,
    frontier: null,
    sprint: sprintSkip,
  };

  const steps: RoutineStep[] = STEP_ORDER.map((id) => {
    const copy = STEP_COPY[id];
    const reason = skip[id];
    if (reason !== null) return { id, ...copy, state: "skipped", skipReason: reason };
    return { id, ...copy, state: done[id] ? "done" : "pending" };
  });

  return {
    dayKey,
    startedAt,
    steps,
    complete: startedAt !== null && steps.every((step) => step.state !== "pending"),
    activeStepId: steps.find((step) => step.state === "pending")?.id ?? null,
  };
}

/* ----------------------------- Enter dispatch ---------------------------- */

export type DashboardEnterAction =
  | "start-routine"
  | "continue-routine"
  | "resume-frontier"
  | "none";

/**
 * What a bare `Enter` on the Dashboard does (UX plan §5.1/§5.4): an
 * unstarted routine always STARTS (the start flow re-derives availability
 * and skips ahead inside the same click), a started but incomplete routine
 * CONTINUES at its first pending step, and only a complete routine hands
 * Enter back to resuming the frontier — with `none` when there is no current
 * lesson to resume (curriculum cleared).
 */
export function dashboardEnterAction(
  status: RoutineStatus,
  hasCurrentLesson: boolean,
): DashboardEnterAction {
  if (status.startedAt === null) return "start-routine";
  if (!status.complete) return "continue-routine";
  return hasCurrentLesson ? "resume-frontier" : "none";
}

/* ---------------------------- streak motivation -------------------------- */

/** §5.2 — always-visible explanation of what a streak actually counts. */
const STREAK_RULE =
  "Streaks count consecutive days with at least 1 finished attempt. Goals missing never break streaks.";

/**
 * §5.2 — tiered encouragement copy for the Dashboard's streak block. Static
 * by design: there is no percentile data offline, so the bands are fixed
 * product copy. `detail` always carries the streak rule so the headline can
 * never mislead (a goal-miss visibly cannot break a run).
 */
export function streakEncouragement(current: number): {
  headline: string;
  detail: string;
} {
  const days = Math.max(0, Math.floor(current));
  if (days === 0) {
    return {
      headline: "Start your streak today",
      detail: `Finish one attempt to light the fire. ${STREAK_RULE}`,
    };
  }
  if (days === 1) {
    return {
      headline: "Day 1 — locked in",
      detail: `One more day tomorrow builds the habit. ${STREAK_RULE}`,
    };
  }
  if (days === 2) {
    return {
      headline: "2-Day Streak",
      detail:
        `You're building the consistency habit — top 30% of typists stay with it ` +
        `this long. ${STREAK_RULE}`,
    };
  }
  if (days <= 6) {
    return {
      headline: `${days}-Day Streak: You're in the top 20% of consistent typists!`,
      detail: STREAK_RULE,
    };
  }
  if (days <= 29) {
    return {
      headline: `${days}-Day Streak: top 10% territory — most typists never make it past a week.`,
      detail: STREAK_RULE,
    };
  }
  return {
    headline: `${days}-Day Streak: top 1% discipline — that's a serious habit.`,
    detail: STREAK_RULE,
  };
}

/* ------------------------------ sprint picker ---------------------------- */

/**
 * §5.1 step 3 — the mastered lesson to sprint on: highest `bestWpm`, ties
 * resolved by list order (the first wins), null when nothing is mastered.
 */
export function pickSprintLesson(
  completedLessons: readonly MasteredLesson[],
): MasteredLesson | null {
  let best: MasteredLesson | null = null;
  for (const lesson of completedLessons) {
    if (best === null || lesson.bestWpm > best.bestWpm) best = lesson;
  }
  return best;
}

/* ------------------------------- persistence ----------------------------- */

/** localStorage key prefix for one day's routine clock. */
export const ROUTINE_KEY_PREFIX = "typekernel.routine.";

/** `typekernel.routine.<dayKey>` — one key per local calendar day. */
export function routineStorageKey(dayKey: string): string {
  return `${ROUTINE_KEY_PREFIX}${dayKey}`;
}

/** Narrowed `localStorage` so tests can inject a plain fake. */
export type RoutineStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** When today's routine clock started (epoch ms), scoped to its day. */
export interface RoutineEntry {
  dayKey: string;
  startedAt: number;
}

/** `null` outside a browser (node tests) — all helpers then no-op safely. */
function defaultRoutineStorage(): RoutineStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Tolerant read of ONE day's key: absent, malformed or wrong-shaped JSON all
 * mean "no entry" (`null`), so a corrupted value can never break the card.
 */
export function readRoutine(
  dayKey: string,
  storage: RoutineStorage | null = defaultRoutineStorage(),
): RoutineEntry | null {
  if (storage === null) return null;
  try {
    const raw = storage.getItem(routineStorageKey(dayKey));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { dayKey: storedDayKey, startedAt } = parsed as {
      dayKey?: unknown;
      startedAt?: unknown;
    };
    if (typeof storedDayKey !== "string" || typeof startedAt !== "number") return null;
    if (!Number.isFinite(startedAt)) return null;
    return { dayKey: storedDayKey, startedAt };
  } catch {
    return null;
  }
}

/**
 * The card's read path: an entry written for ANOTHER day (stale key, or a
 * hand-edited payload) is treated as absent — new day, fresh routine.
 */
export function readRoutineForDay(
  dayKey: string,
  storage: RoutineStorage | null = defaultRoutineStorage(),
): RoutineEntry | null {
  const entry = readRoutine(dayKey, storage);
  if (entry === null || entry.dayKey !== dayKey) return null;
  return entry;
}

/** Starts (or restarts) the routine clock under its day key. */
export function writeRoutine(
  entry: RoutineEntry,
  storage: RoutineStorage | null = defaultRoutineStorage(),
): void {
  if (storage === null) return;
  try {
    storage.setItem(routineStorageKey(entry.dayKey), JSON.stringify(entry));
  } catch {
    // Storage full / private mode — the routine simply behaves as unstarted.
  }
}

/** Drops one day's clock (tests / future reset affordances). */
export function clearRoutine(
  dayKey: string,
  storage: RoutineStorage | null = defaultRoutineStorage(),
): void {
  if (storage === null) return;
  try {
    storage.removeItem(routineStorageKey(dayKey));
  } catch {
    // Best effort — a stale entry rolls over on the next local day anyway.
  }
}
