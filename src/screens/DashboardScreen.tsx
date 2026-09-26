import { useEffect, useMemo, useRef, useState } from "react";

import { getLevelMeta, getLesson } from "../content";
import { MasteryGauge, tierLabel } from "../components/MasteryGauge";
import { Sparkline } from "../components/Sparkline";
import { StatCard } from "../components/StatCard";
import { StatusPill } from "../components/StatusPill";
import { AttemptResultPill } from "../components/AttemptResultPill";
import { ConsistencyStrip } from "../components/ConsistencyStrip";
import { GoalRing } from "../components/GoalRing";
import { ACCURACY_GATE } from "../lib/curriculum/rules";
import { attemptsRepo, progressRepo, statsRepo } from "../lib/db/repositories";
import { cn } from "../lib/cn";
import { isEditableFocused } from "../lib/session/focusShield";
import {
  fmt1,
  fmtDelta,
  fmtInt,
  fmtMinutes,
  fmtRelative,
  fmtDayStamp,
  moduleNumber,
} from "../lib/stats/format";
import {
  getConsistency,
  getStreak,
  localDayKey,
  todayProgress,
  type DayConsistency,
  type StreakInfo,
  type TodayProgress,
} from "../lib/stats/dailyService";
import {
  dashboardEnterAction,
  deriveRoutine,
  pickSprintLesson,
  readRoutineForDay,
  streakEncouragement,
  writeRoutine,
  type DashboardEnterAction,
  type DeriveRoutineInput,
  type MasteredLesson,
  type RoutineAttempt,
  type RoutineEntry,
  type RoutineStep,
  type RoutineStepId,
  type RoutineStatus,
} from "../lib/stats/dailyRoutine";
import { getOverallProgress, getPosition, type CurriculumPosition, type OverallProgress } from "../lib/stats/progressService";
import { analyzeWeaknesses, focusKeysOf, targetsToWeakKeys } from "../lib/intelligence/analyzer";
import { DEFAULT_DRILL_CONFIG, buildDrillPlan, newDrillSeed } from "../lib/intelligence/drillService";
import type { WeakKey } from "../lib/stats/weaknessService";
import type { AttemptRow, Lesson, LessonProgress } from "../lib/schemas";
import { useCurriculumStore } from "../stores/useCurriculumStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useSettingsStore } from "../stores/useSettingsStore";
import { useStatsStore } from "../stores/useStatsStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Dashboard screen — implemented from `screens/dashboard_typekernel/code.html`
 * (Phase 5 plan §3.4): progress hero with mastery gauge, active-module resume
 * card, daily goals, weakness drill launcher, recent attempts and the weak
 * keys radar. All numbers come from the SQL-backed §3.1/§3.2/§3.3 services.
 */

interface LastAttemptHint {
  wpm: number;
  accuracy: number;
  attemptCount: number;
}

interface DashboardData {
  progress: OverallProgress;
  position: CurriculumPosition;
  streak: StreakInfo;
  today: TodayProgress;
  strip: DayConsistency[];
  weakKeys: WeakKey[];
  recent: AttemptRow[];
  spark: { x: number; y: number }[];
  sparkDelta: number;
  dbSizeBytes: number | null;
  currentLessonLast: LastAttemptHint | null;
  /** Today's routine clock (localStorage), or null when not started. */
  routineEntry: RoutineEntry | null;
  /** Finished attempts (all kinds) at or after the routine start. */
  routineAttempts: RoutineAttempt[];
}

/** Radar bar color per the design's accuracy thresholds. */
function radarTone(accuracy: number): string {
  if (accuracy < 85) return "bg-error";
  if (accuracy < 93) return "bg-secondary";
  return "bg-primary";
}

/** Dev-only demo-history launcher (§3.6) — dynamic import keeps the seeder
 * out of production bundles, and `import.meta.env.DEV` strips the button. */
function DemoSeedButton() {
  const [busy, setBusy] = useState(false);
  if (!import.meta.env.DEV) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { seedDemoHistory } = await import("../lib/stats/demoSeed");
          await seedDemoHistory();
          useStatsStore.getState().invalidate();
          window.location.reload();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded border border-surface-container-highest/60 bg-surface-container px-2 py-0.5 font-code-sm text-[10px] uppercase tracking-wider text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
    >
      {busy ? "generating…" : "generate demo history [dev]"}
    </button>
  );
}

/* --------------------------- §5.1 daily routine -------------------------- */

/**
 * §4.1.4 — true while a modal overlay (Shortcuts sheet, Command Palette)
 * covers the dashboard. `isEditableFocused()` alone misses a dialog whose
 * box holds focus without being editable, so Enter could start a routine
 * behind the overlay (same guard WeaknessTrainingScreen applies to drill
 * hotkeys).
 */
function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/** Completed lessons as the sprint picker consumes them (best WPM first). */
function masteredLessonsOf(
  progressMap: Record<string, LessonProgress>,
): MasteredLesson[] {
  return Object.values(progressMap)
    .filter((row) => row.status === "completed")
    .map((row) => ({ id: row.lessonId, bestWpm: row.bestWpm }));
}

/** Everything the routine card renders from and Enter dispatches through. */
interface RoutineContext {
  input: DeriveRoutineInput;
  status: RoutineStatus;
  mastered: MasteredLesson[];
  currentLesson: Lesson | null;
}

function routineContextOf(
  data: DashboardData,
  progressMap: Record<string, LessonProgress>,
  adaptiveEnabled: boolean,
): RoutineContext {
  const mastered = masteredLessonsOf(progressMap);
  const currentLesson = data.position.currentLesson;
  const input: DeriveRoutineInput = {
    startedAt: data.routineEntry?.startedAt ?? null,
    dayKey: data.routineEntry?.dayKey ?? localDayKey(Date.now()),
    attemptsSinceStart: data.routineAttempts,
    adaptiveEnabled,
    analysisAvailable: data.weakKeys.length > 0,
    completedLessonCount: mastered.length,
    sprintLessonId: pickSprintLesson(mastered)?.id ?? null,
    masteredLessonIds: mastered.map((lesson) => lesson.id),
  };
  return {
    input,
    status: deriveRoutine(input),
    mastered,
    currentLesson,
  };
}

/**
 * §5.1 — launches one routine step (the card/Enter dispatches; steps never
 * chain into each other):
 * - `warmup`: the analyzer's live queue through the normal `kind='weakness'`
 *   pipeline — one 60 s set (~150 keys) — gated on the Settings toggle the
 *   same way the Weakness screen's own start button is;
 * - `frontier`: the current curriculum lesson;
 * - `sprint`: `pickSprintLesson` (fastest mastered module).
 * Returns false when the step cannot launch, so the caller falls through to
 * the next pending step instead of dead-clicking.
 */
async function launchRoutineStep(
  stepId: RoutineStepId,
  ctx: RoutineContext,
): Promise<boolean> {
  if (stepId === "warmup") {
    if (!ctx.input.adaptiveEnabled) return false;
    const analysis = await analyzeWeaknesses();
    if (analysis.empty || focusKeysOf(analysis, 3).length === 0) return false;
    const plan = buildDrillPlan(
      analysis,
      { ...DEFAULT_DRILL_CONFIG, sets: 1, setLength: 150 },
      newDrillSeed(),
      ctx.currentLesson?.level ?? 1,
    );
    await useSessionStore.getState().startDrill(plan);
    useUiStore.getState().navigate("weakness-training");
    return true;
  }
  if (stepId === "frontier") {
    if (ctx.currentLesson === null) return false;
    useCurriculumStore.getState().startLesson(ctx.currentLesson.id);
    return true;
  }
  const sprint = pickSprintLesson(ctx.mastered);
  if (sprint === null) return false;
  useCurriculumStore.getState().startLesson(sprint.id);
  return true;
}

/**
 * The routine's single entry point (card button AND Enter). Starting writes
 * the clock FIRST — attempts only count from now — then runs the first
 * launchable pending step; a step that cannot launch is skipped over inside
 * the same click, exactly like a skipped step in `deriveRoutine`. Returns
 * whether something actually launched so the caller can show a reason.
 */
async function runRoutineAction(
  action: DashboardEnterAction,
  ctx: RoutineContext,
  onRoutineStarted: (entry: RoutineEntry) => void,
): Promise<boolean> {
  if (action === "none") return false;
  if (action === "resume-frontier") {
    if (ctx.currentLesson === null) return false;
    useCurriculumStore.getState().startLesson(ctx.currentLesson.id);
    return true;
  }
  let status = ctx.status;
  if (action === "start-routine") {
    const startedAt = Date.now();
    const entry: RoutineEntry = { dayKey: localDayKey(startedAt), startedAt };
    writeRoutine(entry);
    onRoutineStarted(entry);
    status = deriveRoutine({
      ...ctx.input,
      startedAt: entry.startedAt,
      dayKey: entry.dayKey,
    });
  }
  for (const step of status.steps) {
    if (step.state !== "pending") continue;
    if (await launchRoutineStep(step.id, ctx)) return true;
  }
  return false;
}

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [routineBusy, setRoutineBusy] = useState(false);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const dbErrorMessage = useCurriculumStore((s) => s.dbError);
  const lastBackupAt = useSettingsStore((s) => s.settings.lastBackupAt);
  const adaptiveEnabled = useSettingsStore((s) => s.settings.adaptiveLessons);
  const progressMap = useCurriculumStore((s) => s.progress);
  // First paint must not race bootstrapping: on a FRESH database the
  // dashboard mounted before the 260 progress rows existed and read an empty
  // position — showing "Curriculum Complete" on day one. Load (and reload)
  // once the curriculum store reports bootstrapping done.
  const curriculumLoaded = useCurriculumStore((s) => s.loaded);
  const version = useStatsStore((s) => s.version);
  const now = Date.now();
  // Synchronous in-flight guard: `useState` flips too late for a second
  // Enter inside the same tick (or before React flushes).
  const launchingRef = useRef(false);

  useEffect(() => {
    if (!curriculumLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        // §5.1: the routine clock lives in localStorage, its progress in the
        // attempt ledger — both read before the card first paints.
        const routineEntry = readRoutineForDay(localDayKey(now));
        const [progress, position, streak, today, strip, weakKeys, recent, daily7, dbSizeBytes, routineAttempts] =
          await Promise.all([
            getOverallProgress(),
            getPosition(),
            getStreak(now),
            todayProgress(now),
            // §18 consistency: last 14 days from the same sources as the
            // goals panel (training_sessions + lesson_progress) — one
            // batched read, no new queries per cell.
            getConsistency(14, now),
            // §3.7: the drill card + radar read the LIVE analyzer queue
            // (rolling 30d, worst-accuracy-first) — the same source the
            // Weakness Training screen uses, so the numbers can never
            // contradict it.
            analyzeWeaknesses().then(targetsToWeakKeys),
            attemptsRepo.recent(5),
            statsRepo.dailySeries(now - 7 * 86_400_000),
            statsRepo.dbSizeBytes(),
            routineEntry === null
              ? Promise.resolve<RoutineAttempt[]>([])
              : attemptsRepo.finishedSince(routineEntry.startedAt),
          ]);

        // Last-attempt hint for the resume card.
        const currentId = position.currentLesson?.id ?? null;
        const currentHistory = currentId
          ? await attemptsRepo.historyFor(currentId, 1)
          : [];
        const currentProgress = currentId ? await progressRepo.get(currentId) : null;

        const spark = daily7.map((bucket) => ({
          x: new Date(`${bucket.day}T12:00:00`).getTime(),
          y: bucket.avgWpm,
        }));

        if (!cancelled) {
          setData({
            progress,
            position,
            streak,
            today,
            strip,
            weakKeys,
            recent,
            spark,
            sparkDelta:
              spark.length >= 2 ? spark[spark.length - 1].y - spark[0].y : 0,
            dbSizeBytes,
            currentLessonLast: currentHistory[0]
              ? {
                  wpm: currentHistory[0].wpm,
                  accuracy: currentHistory[0].accuracy,
                  attemptCount: currentProgress?.attemptCount ?? 0,
                }
              : null,
            routineEntry,
            routineAttempts,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setDbError(
            error instanceof Error ? error.message : "Database unavailable",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `version` joins the deps so a ledger write (finished attempt) re-reads
    // the routine's steps live — the card flips a step to done in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curriculumLoaded, version]);

  /**
   * Runs one routine action with busy/error state around it. Only reads the
   * `ctx` it is handed, so the Enter listener may keep a slightly stale
   * closure — everything it touches (stores, setState, refs) is stable.
   */
  const runAction = async (
    action: DashboardEnterAction,
    ctx: RoutineContext,
  ): Promise<void> => {
    if (launchingRef.current) return;
    launchingRef.current = true;
    setRoutineBusy(true);
    setRoutineError(null);
    try {
      const launched = await runRoutineAction(action, ctx, (entry) =>
        setData((prev) => (prev === null ? prev : { ...prev, routineEntry: entry })),
      );
      if (!launched) {
        setRoutineError("No routine step can start right now — try again after your first lesson.");
      }
    } catch (error) {
      setRoutineError(
        error instanceof Error ? error.message : "Could not start the routine",
      );
    } finally {
      launchingRef.current = false;
      setRoutineBusy(false);
    }
  };

  // Enter runs the Daily Routine while it owns the key (plan §5.1/§5.4):
  // unstarted → START (clock + first launchable step), started → CONTINUE at
  // the first pending step, complete → fall back to resuming the frontier.
  // §4.1.4 focus shield: an editable field (e.g. the Command Palette's
  // query input) keeps its keystrokes, an open dialog owns the keyboard
  // outright, and a button/link the user deliberately focused (Tab or click)
  // keeps its Enter so it activates instead of starting a routine from
  // under it (same guards as FrontierHud).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableFocused()) return;
      if (modalOpen()) return;
      if (useUiStore.getState().activeScreen !== "dashboard") return;
      const active = document.activeElement;
      if (active instanceof HTMLSelectElement) return;
      if (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement) return;
      if (data === null) return;
      if (launchingRef.current) return;
      const ctx = routineContextOf(
        data,
        useCurriculumStore.getState().progress,
        useSettingsStore.getState().settings.adaptiveLessons,
      );
      const action = dashboardEnterAction(
        ctx.status,
        ctx.currentLesson !== null,
      );
      if (action === "none") return;
      event.preventDefault();
      void runAction(action, ctx);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const levelMeta = useMemo(
    () => (data?.position.currentLesson ? getLevelMeta(data.position.currentLesson.level) : null),
    [data],
  );

  /* ------------------------------ states ------------------------------ */

  if (dbError !== null || (dbErrorMessage !== null && data === null)) {
    return (
      <main className="flex w-full flex-1 items-center justify-center bg-surface p-space-lg">
        <div className="max-w-md rounded-xl bg-surface-container-low p-space-lg text-center shadow-xl">
          <span className="material-symbols-outlined text-[36px] text-error">database</span>
          <h2 className="mt-2 font-headline-lg text-headline-lg text-on-surface">
            Database Offline
          </h2>
          <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
            {dbError ?? dbErrorMessage}
          </p>
        </div>
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="flex w-full flex-1 items-center justify-center bg-surface">
        <span className="animate-pulse font-code-sm text-code-sm uppercase tracking-widest text-outline">
          Loading your progress…
        </span>
      </main>
    );
  }

  const { progress, position, streak, today, weakKeys, recent } = data;
  // The drill card's count must match the chips it actually renders (the
  // radar separately shows the full top-5 from the shared selector).
  const drillChips = weakKeys.slice(0, 4);
  const currentLesson = position.currentLesson;
  const currentProgress = currentLesson ? progressMap[currentLesson.id] : undefined;
  const masteredRemaining = progress.totalLessons - progress.completedLessons;
  const wpmTrendPct =
    progress.lifetimeWpm > 0 ? (progress.wpmTrend / progress.lifetimeWpm) * 100 : 0;

  // §5.1 — the routine card + Enter dispatch both read this one derivation.
  const routineCtx = routineContextOf(data, progressMap, adaptiveEnabled);
  const enterAction = dashboardEnterAction(
    routineCtx.status,
    routineCtx.currentLesson !== null,
  );
  const activeStep: RoutineStep | null =
    routineCtx.status.steps.find((step) => step.id === routineCtx.status.activeStepId) ??
    null;
  const encouragement = streakEncouragement(streak.current);

  return (
    <main className="flex w-full flex-1 flex-col gap-space-md overflow-y-auto bg-surface p-space-base md:p-space-lg">
      {/* ------------------------------ Hero ------------------------------ */}
      <section className="relative overflow-hidden rounded-xl border border-surface-container-highest/40 bg-gradient-to-br from-surface-container-low to-surface-container-lowest p-space-lg shadow-2xl">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary-container/10 blur-3xl" />
        <div className="relative flex flex-col gap-space-lg md:flex-row md:items-start md:justify-between">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 font-code-sm text-code-sm">
              <span className="flex items-center gap-1.5 rounded bg-surface-container-high px-2 py-0.5 font-bold text-primary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-container" />
                {fmtInt(progress.totalAttempts)} sessions completed
              </span>
            </div>
            <h1 className="mt-3 font-display-lg text-4xl font-bold tracking-tight text-on-surface">
              Welcome back
            </h1>
            <p className="mt-1 max-w-xl font-body-md text-body-md text-on-surface-variant">
              Pick up where you left off or practice your weak keys.
            </p>
            <div className="mt-space-base flex flex-wrap gap-space-sm">
              <button
                type="button"
                onClick={() => useUiStore.getState().navigate("lessons")}
                className="flex items-center gap-2 rounded-lg border border-surface-container-highest/60 bg-surface-container px-space-base py-2 font-label-md text-label-md font-semibold text-on-surface transition-colors hover:bg-surface-container-high"
              >
                <span className="material-symbols-outlined text-[18px] text-primary">map</span>
                <span>Browse Lessons</span>
              </button>
            </div>

            {/* Rolling stats strip */}
            <div className="mt-space-lg flex flex-wrap gap-space-md">
              <StatCard
                icon="speed"
                label="Rolling Speed"
                value={fmt1(progress.recentWpm)}
                unit="WPM"
                note={`(${fmtDelta(wpmTrendPct)}%)`}
                noteTone={wpmTrendPct >= 0 ? "positive" : "negative"}
              />
              <StatCard
                icon="verified"
                label="Code Accuracy"
                value={fmt1(progress.recentAccuracy)}
                unit="%"
                note={`(${fmtDelta(progress.accuracyTrend)}% lifetime)`}
                noteTone={progress.accuracyTrend >= 0 ? "positive" : "negative"}
              />
              <StatCard
                icon="keyboard_command_key"
                label="Keys Typed"
                value={fmtInt(progress.lifetimeKeys)}
                unit="lifetime"
              />
              <StatCard
                icon="schedule"
                label="Time Today"
                value={fmtMinutes(today.minutes.actual)}
                unit={
                  today.minutes.disabled
                    ? "goal disabled"
                    : `of ${today.goals.minutesGoal}m goal`
                }
              />
            </div>
          </div>

          {/* Mastery gauge */}
          <div className="flex items-center gap-space-lg rounded-xl border border-surface-container-highest/40 bg-surface-container-lowest/60 p-space-base">
            <MasteryGauge pct={progress.overallPct} />
            <div>
              <span className="font-code-sm text-code-sm font-bold uppercase tracking-wider text-primary">
                {tierLabel(progress.overallPct)}
              </span>
              <p className="font-headline-md text-lg font-semibold text-on-surface">
                {progress.completedLessons} / {progress.totalLessons} Mastered
              </p>
              <p className="font-code-sm text-code-sm text-on-surface-variant">
                {fmtInt(masteredRemaining)} lessons remaining
              </p>
              <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-surface-container-highest">
                <div
                  className="h-full rounded-full bg-primary-container"
                  style={{ width: `${Math.min(100, progress.overallPct)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --------------------- Main grid (2/3 + 1/3) --------------------- */}
      <div className="grid grid-cols-1 gap-space-md xl:grid-cols-3">
        <div className="flex flex-col gap-space-md xl:col-span-2">
          {/* Daily Routine (§5.1) — the dashboard's primary action until the
              three steps clear; a complete day renders its celebration. */}
          <section
            aria-label="Daily routine"
            className={cn(
              "rounded-xl border p-space-lg shadow-xl",
              routineCtx.status.complete
                ? "border-surface-container-highest/40 bg-surface-container-low"
                : "border-primary/30 bg-gradient-to-br from-surface-container-low to-surface-container-lowest",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-primary-container">
                  checklist
                </span>
                Daily Routine
              </h3>
              <span className="flex items-center gap-2">
                {routineCtx.status.complete ? (
                  <StatusPill tone="mastered">Complete ✓</StatusPill>
                ) : (
                  routineCtx.status.startedAt !== null && (
                    <StatusPill tone="inProgress">In progress</StatusPill>
                  )
                )}
                <span className="font-code-sm text-code-sm font-bold text-outline">
                  {fmtDayStamp(now)}
                </span>
              </span>
            </div>
            <p className="mt-0.5 font-code-sm text-code-sm text-on-surface-variant">
              Warm your weak keys, push two modules, then sprint — about 15
              focused minutes.
            </p>

            <ol className="mt-3 flex flex-col gap-1.5">
              {routineCtx.status.steps.map((step, index) => {
                const active =
                  step.state === "pending" &&
                  step.id === routineCtx.status.activeStepId;
                return (
                  <li
                    key={step.id}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-space-sm py-1.5 transition-colors",
                      active
                        ? "border-primary/40 bg-primary-container/15"
                        : "border-surface-container-highest/40 bg-surface-container-lowest/50",
                      step.state === "skipped" && "opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-code-sm text-[11px] font-bold",
                        step.state === "done"
                          ? "bg-primary text-on-primary"
                          : active
                            ? "border border-primary text-primary"
                            : "border border-surface-container-highest text-outline",
                      )}
                    >
                      {step.state === "done"
                        ? "✓"
                        : step.state === "skipped"
                          ? "—"
                          : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-label-md text-sm font-semibold text-on-surface">
                        {step.title}
                        {active && (
                          <span className="font-code-sm text-[9px] uppercase tracking-wider text-primary">
                            next
                          </span>
                        )}
                      </span>
                      <span className="block font-code-sm text-code-sm text-on-surface-variant">
                        {step.state === "skipped" ? step.skipReason : step.detail}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>

            {enterAction === "start-routine" || enterAction === "continue-routine" ? (
              <button
                type="button"
                disabled={routineBusy}
                onClick={() => void runAction(enterAction, routineCtx)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container px-space-lg py-2.5 font-label-md text-sm font-semibold text-on-primary-container shadow-lg shadow-primary-container/30 transition-all hover:bg-tertiary-container disabled:cursor-wait disabled:opacity-60"
              >
                <span className="rounded border border-on-primary-container/40 px-1.5 py-0.5 font-code-sm text-[10px]">
                  Enter
                </span>
                <span>
                  {enterAction === "start-routine"
                    ? "Start Daily Routine"
                    : `Continue — ${activeStep?.title ?? "next step"}`}
                </span>
              </button>
            ) : (
              <div className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary-container/20 px-space-lg py-2.5 font-label-md text-sm font-semibold text-primary">
                <span className="material-symbols-outlined text-[16px]">
                  task_alt
                </span>
                <span>Daily Routine Complete</span>
              </div>
            )}
            {routineError !== null && (
              <p className="mt-2 font-code-sm text-code-sm text-error">
                {routineError}
              </p>
            )}
          </section>

          {/* Active module card */}
          <section className="flex flex-col rounded-xl border border-surface-container-highest/40 bg-surface-container-low shadow-sm">
            {currentLesson ? (
              <div className="flex flex-col gap-space-md p-space-lg">
                <div className="flex flex-wrap items-start justify-between gap-space-md">
                  <div>
                    <div className="flex items-center gap-2 font-code-sm text-code-sm">
                      <span className="font-bold tracking-wider text-primary">
                        Current Lesson: {moduleNumber(currentLesson.level, currentLesson.orderIndex)}
                      </span>
                      <StatusPill tone="inProgress">In progress</StatusPill>
                    </div>
                    <h2 className="mt-1.5 font-headline-lg text-headline-lg text-on-surface">
                      {currentLesson.title}
                    </h2>
                    <p className="font-code-sm text-code-sm text-on-surface-variant">
                      Level {currentLesson.level} • {levelMeta?.name ?? "Curriculum"} •{" "}
                      {progress.perLevel[currentLesson.level - 1]?.completed ?? 0} of{" "}
                      {progress.perLevel[currentLesson.level - 1]?.total ?? 0} mastered
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="block font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                      Last Attempt
                    </span>
                    <span className="font-headline-lg text-2xl font-bold text-primary">
                      {data.currentLessonLast ? `${Math.round(data.currentLessonLast.wpm)} WPM` : "—"}
                    </span>
                    {data.currentLessonLast && (
                      <span className="block font-code-sm text-code-sm text-on-surface-variant">
                        {fmt1(data.currentLessonLast.accuracy)}% accuracy{" "}
                        {data.currentLessonLast.accuracy >= ACCURACY_GATE
                          ? "(gate met)"
                          : `(needs ${ACCURACY_GATE}%)`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Content preview line with cursor block */}
                <div className="overflow-hidden rounded-lg border border-surface-container-highest/40 bg-surface-container-lowest px-space-base py-2 font-code-lg text-code-lg text-on-surface">
                  <span className="whitespace-pre">
                    {currentLesson.content.split("\n")[0]?.slice(0, 72)}
                  </span>
                  <span className="ml-0.5 inline-block h-5 w-2.5 animate-pulse bg-primary-container align-middle" />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-space-md">
                  <div className="flex items-center gap-2 font-code-sm text-code-sm text-on-surface-variant">
                    <span className="material-symbols-outlined text-[14px] text-primary-container">
                      tune
                    </span>
                    <span>
                      {currentLesson.targetKeys.length > 0
                        ? `Targets: ${currentLesson.targetKeys.slice(0, 4).join(" ")}`
                        : "Full-keyboard module"}
                      {" | "}
                      Best: {currentProgress ? Math.round(currentProgress.bestWpm) : 0} WPM{" "}
                      {" | "} Attempts: {data.currentLessonLast?.attemptCount ?? 0}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      useCurriculumStore.getState().startLesson(currentLesson.id)
                    }
                    className="flex items-center gap-2 rounded-lg bg-primary-container px-space-lg py-2.5 font-label-md text-sm font-semibold text-on-primary-container shadow-lg shadow-primary-container/30 transition-all hover:bg-tertiary-container"
                  >
                    <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    <span>
                      Resume Lesson {moduleNumber(currentLesson.level, currentLesson.orderIndex)}
                      {enterAction === "resume-frontier" ? " (Enter)" : ""}
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-space-lg text-center">
                <p className="font-headline-md text-headline-md text-on-surface">
                  Curriculum Complete
                </p>
                <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
                  Every module is mastered — replay any lesson from the Lessons screen.
                </p>
              </div>
            )}
          </section>

          {/* Recent attempts */}
          <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-lg shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-primary-container">
                  history
                </span>
                Recent Attempts
              </h3>
              <button
                type="button"
                onClick={() => useUiStore.getState().navigate("statistics")}
                className="font-code-sm text-code-sm font-bold tracking-wider text-primary hover:text-primary-fixed"
              >
                View all →
              </button>
            </div>
            {recent.length === 0 ? (
              <p className="rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/50 px-space-base py-space-lg text-center font-code-sm text-code-sm text-outline">
                No attempts yet — finish your first lesson to see it here.
              </p>
            ) : (
              <table className="w-full text-left font-code-md text-code-md">
                <thead>
                  <tr className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                    <th className="pb-2 pr-2 font-semibold">Lesson</th>
                    <th className="pb-2 pr-2 text-right font-semibold">WPM</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Accuracy</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Errors</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Backspaces</th>
                    <th className="pb-2 pr-2 text-center font-semibold">Result</th>
                    <th className="pb-2 text-right font-semibold">When</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((attempt) => (
                    <tr
                      key={attempt.id}
                      className="border-t border-white/5"
                    >
                      <td className="py-2 pr-2 text-on-surface">
                        <RecentAttemptModule lessonId={attempt.lessonId} />
                      </td>
                      <td className="py-2 pr-2 text-right font-bold text-primary">
                        {Math.round(attempt.wpm)}
                      </td>
                      <td className="py-2 pr-2 text-right text-on-surface">
                        {fmt1(attempt.accuracy)}%
                      </td>
                      <td className="py-2 pr-2 text-right text-error">{attempt.errorCount}</td>
                      <td className="py-2 pr-2 text-right text-on-surface-variant">
                        {attempt.backspaceCount}
                      </td>
                      <td className="py-2 pr-2 text-center">
                        <AttemptResultPill completed={attempt.completed} wpm={attempt.wpm} accuracy={attempt.accuracy} />
                      </td>
                      <td className="py-2 text-right text-on-surface-variant">
                        {fmtRelative(attempt.finishedAt, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        {/* ------------------------- Sidebar (1/3) ------------------------- */}
        <div className="flex flex-col gap-space-md">
          {/* Daily goals — live editable targets (§18); a met day renders the
              completed state (filled + check), never a modal. */}
          <section
            aria-label="Daily goals"
            className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-primary-container">
                  track_changes
                </span>
                Daily Goals
              </h3>
              <span className="flex items-center gap-2">
                {today.metAll && (
                  <StatusPill tone="mastered">Met ✓</StatusPill>
                )}
                <span className="font-code-sm text-code-sm font-bold text-outline">
                  {fmtDayStamp(now)}
                </span>
              </span>
            </div>
            {today.enabledCount === 0 ? (
              <p className="rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/50 px-space-sm py-2 text-center font-code-sm text-code-sm text-outline">
                Goals disabled — set targets in{" "}
                <button
                  type="button"
                  onClick={() => useUiStore.getState().navigate("settings")}
                  className="font-bold text-primary hover:text-primary-fixed"
                >
                  Settings → Training
                </button>
                .
              </p>
            ) : (
              <>
                {/* §5.3/§5.4 — animated rings: sweep on mount, celebratory
                    ring + check pop once a goal turns green. Disabled goals
                    render their muted "off" ring instead of vanishing. */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <GoalRing
                    label="Training Time"
                    value={fmtMinutes(today.minutes.actual)}
                    target={`of ${today.goals.minutesGoal}m`}
                    pct={today.minutes.pct}
                    met={today.minutes.met}
                    disabled={today.minutes.disabled}
                  />
                  <GoalRing
                    label="Lessons Done"
                    value={`${today.lessons.actual}`}
                    target={`of ${today.goals.lessonsGoal}`}
                    pct={today.lessons.pct}
                    met={today.lessons.met}
                    disabled={today.lessons.disabled}
                  />
                  <GoalRing
                    label="Characters"
                    value={fmtInt(today.chars.actual)}
                    target={`of ${fmtInt(today.goals.charsGoal)}`}
                    pct={today.chars.pct}
                    met={today.chars.met}
                    disabled={today.chars.disabled}
                  />
                </div>
                <p className="mt-2 font-code-sm text-[10px] uppercase tracking-wider text-outline">
                  {today.metCount} of {today.enabledCount} goals met
                </p>
              </>
            )}
            {/* §5.2 — tiered encouragement with the streak rule always
                visible (the old hover `title` hid it). */}
            <div className="mt-2 rounded-lg bg-surface-container-lowest px-space-sm py-1.5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[14px] text-primary-container">
                  local_fire_department
                </span>
                <span className="min-w-0 flex-1 font-label-md text-sm font-semibold text-on-surface">
                  {encouragement.headline}
                </span>
                <span className="shrink-0 font-code-sm text-[10px] uppercase tracking-wider text-outline">
                  best {streak.best}
                </span>
              </div>
              <p className="mt-1 font-code-sm text-[10px] leading-snug text-on-surface-variant">
                {encouragement.detail}
              </p>
            </div>
            <div className="mt-2">
              <ConsistencyStrip days={data.strip} variant="compact" />
            </div>
          </section>

          {/* Weakness drill launcher — Phase 6: functional, live queue */}
          <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-primary-container">
                  monitor_heart
                </span>
                Weakness Drill
              </h3>
              <span className="font-code-sm text-[10px] font-bold uppercase tracking-wider text-outline">
                {drillChips.length} targets
              </span>
            </div>
            <p className="font-code-sm text-code-sm text-on-surface-variant">
              Auto-generated from your rolling 30-day key statistics.
            </p>
            {weakKeys.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/50 px-space-sm py-2 text-center font-code-sm text-code-sm text-outline">
                Complete a few lessons to detect weaknesses — key statistics
                build as you type.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {drillChips.map((weak) => (
                  <span
                    key={`${weak.key}-${weak.shiftRequired ? "s" : "b"}`}
                    className="flex h-9 min-w-9 items-center justify-center rounded-lg border border-surface-container-highest/60 bg-surface-container-lowest px-1.5 font-code-md text-code-md font-bold text-on-surface"
                  >
                    {weak.key}
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => useUiStore.getState().navigate("weakness-training")}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary-container py-2 font-label-md text-sm font-semibold text-on-primary-container shadow-lg shadow-primary-container/25 transition-all hover:bg-tertiary-container"
            >
              <span className="material-symbols-outlined text-[16px]">bolt</span>
              Start Weakness Drill
            </button>
          </section>

          {/* Weak keys radar */}
          <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
            <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
              <span className="material-symbols-outlined text-[18px] text-primary-container">
                warning
              </span>
              Weak Keys Radar
            </h3>
            <p className="mt-0.5 font-code-sm text-code-sm text-on-surface-variant">
              Lowest accuracy tokens, rolling 30-day window.
            </p>
            {weakKeys.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/50 px-space-sm py-space-base text-center font-code-sm text-code-sm text-outline">
                No data yet — key statistics build as you type.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {weakKeys.map((weak) => (
                  <div key={`${weak.key}-${weak.shiftRequired ? "s" : "b"}`} className="flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-container-highest/60 bg-surface-container-lowest font-code-md text-code-md font-bold text-on-surface">
                      {weak.key}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                        <span>accuracy</span>
                        <span className="text-on-surface">{Math.round(weak.accuracy)}%</span>
                      </div>
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
                        <div
                          className={cn("h-full rounded-full", radarTone(weak.accuracy))}
                          style={{ width: `${Math.min(100, weak.accuracy)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
              <span>7-day speed trend</span>
              <span className={cn("font-bold", data.sparkDelta >= 0 ? "text-primary" : "text-error")}>
                ▲ {fmtDelta(data.sparkDelta)} WPM
              </span>
            </div>
            <div className="mt-1">
              <Sparkline points={data.spark} />
            </div>
          </section>
        </div>
      </div>

      {/* --------------------------- Footer line --------------------------- */}
      <footer className="flex flex-wrap items-center justify-between gap-2 px-1 py-1 font-code-sm text-[10px] uppercase tracking-wider text-outline">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
          All data stored locally
        </span>
        <span className="flex items-center gap-3">
          <DemoSeedButton />
          <span>
            Database:{" "}
            {data.dbSizeBytes !== null ? `${fmtInt(data.dbSizeBytes / 1024 / 1024)} MB` : "—"} •
            Last backup:{" "}
            {lastBackupAt !== null ? new Date(lastBackupAt).toLocaleDateString() : "—"}
          </span>
        </span>
      </footer>
    </main>
  );
}

/** Lesson cell of the recent-attempts table ("3.14 Struct Arrow & Member"). */
function RecentAttemptModule({ lessonId }: { lessonId: string }) {
  // Resolved from the bundled curriculum (cheap map lookup, no extra query).
  const lesson = getLesson(lessonId);
  if (!lesson) return <span>{lessonId}</span>;
  const short = lesson.title.length > 24 ? `${lesson.title.slice(0, 24)}…` : lesson.title;
  return (
    <span>
      {moduleNumber(lesson.level, lesson.orderIndex)} {short}
    </span>
  );
}
