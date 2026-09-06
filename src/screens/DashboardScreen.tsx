import { useEffect, useMemo, useState } from "react";

import { getLevelMeta, getLesson } from "../content";
import { MasteryGauge, tierLabel } from "../components/MasteryGauge";
import { Sparkline } from "../components/Sparkline";
import { StatCard } from "../components/StatCard";
import { evaluateAttempt } from "../lib/curriculum/rules";
import { attemptsRepo, progressRepo, statsRepo } from "../lib/db/repositories";
import { cn } from "../lib/cn";
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
  DEFAULT_DAILY_GOALS,
  getStreak,
  getTodayActuals,
  type DailyActuals,
  type StreakInfo,
} from "../lib/stats/dailyService";
import { getOverallProgress, getPosition, type CurriculumPosition, type OverallProgress } from "../lib/stats/progressService";
import { analyzeWeaknesses, targetsToWeakKeys } from "../lib/intelligence/analyzer";
import type { WeakKey } from "../lib/stats/weaknessService";
import type { AttemptRow } from "../lib/schemas";
import { useCurriculumStore } from "../stores/useCurriculumStore";
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
  today: DailyActuals;
  weakKeys: WeakKey[];
  recent: AttemptRow[];
  spark: { x: number; y: number }[];
  sparkDelta: number;
  dbSizeBytes: number | null;
  currentLessonLast: LastAttemptHint | null;
}

/** Radar bar color per the design's accuracy thresholds. */
function radarTone(accuracy: number): string {
  if (accuracy < 85) return "bg-error";
  if (accuracy < 93) return "bg-secondary";
  return "bg-primary";
}

function resultChip(completed: boolean, wpm: number, accuracy: number) {
  const passed = evaluateAttempt({ completed, accuracy, wpm }) === "PASS";
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 font-code-sm text-[10px] font-bold tracking-wider",
        passed ? "bg-secondary-container/40 text-secondary" : "bg-error-container text-error",
      )}
    >
      {passed ? "PASS" : "FAIL"}
    </span>
  );
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

export default function DashboardScreen() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const dbErrorMessage = useCurriculumStore((s) => s.dbError);
  const progressMap = useCurriculumStore((s) => s.progress);
  const now = Date.now();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [progress, position, streak, today, weakKeys, recent, daily7, dbSizeBytes] =
          await Promise.all([
            getOverallProgress(),
            getPosition(),
            getStreak(now),
            getTodayActuals(now),
            // §3.7: the drill card + radar read the LIVE analyzer queue
            // (rolling 30d, worst-accuracy-first) — the same source the
            // Weakness Training screen uses, so the numbers can never
            // contradict it.
            analyzeWeaknesses().then(targetsToWeakKeys),
            attemptsRepo.recent(5),
            statsRepo.dailySeries(now - 7 * 86_400_000),
            statsRepo.dbSizeBytes(),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enter resumes the current lesson from the dashboard (plan §3.4).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (useUiStore.getState().activeScreen !== "dashboard") return;
      const current = data?.position.currentLesson;
      if (current) {
        event.preventDefault();
        useCurriculumStore.getState().startLesson(current.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
            Operator Status Offline
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
          Loading operator status…
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
                OPERATOR ONLINE // SESSION {fmtInt(progress.totalAttempts)}
              </span>
              <span className="text-outline-variant">•</span>
              <span className="text-on-surface-variant">LOCAL TRAINING PIPELINE</span>
            </div>
            <h1 className="mt-3 font-display-lg text-4xl font-bold tracking-tight text-on-surface">
              Welcome back, Operator.
            </h1>
            <p className="mt-1 max-w-xl font-body-md text-body-md text-on-surface-variant">
              Your neuromuscular buffer is warm. Resume the active module or run
              a weakness drill to keep the streak alive.
            </p>

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
                value={fmtMinutes(today.minutes)}
                unit={`of ${DEFAULT_DAILY_GOALS.minutesGoal}m goal`}
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
                {fmtInt(masteredRemaining)} modules remaining
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
          {/* Active module card */}
          <section className="relative flex flex-col overflow-hidden rounded-xl border border-primary-container/50 bg-surface-container-low shadow-2xl">
            <div className="absolute bottom-0 left-0 top-0 w-1.5 bg-primary-container shadow-[0_0_12px_rgb(249_115_22_calc(0.9_*_var(--accent-alpha)))]" />
            {currentLesson ? (
              <div className="flex flex-col gap-space-md p-space-lg pl-space-xl">
                <div className="flex flex-wrap items-start justify-between gap-space-md">
                  <div>
                    <div className="flex items-center gap-2 font-code-sm text-code-sm">
                      <span className="font-bold tracking-wider text-primary">
                        ACTIVE MODULE // {moduleNumber(currentLesson.level, currentLesson.orderIndex)}
                      </span>
                      <span className="rounded bg-primary-container px-1.5 py-0.5 font-label-sm text-[10px] font-bold uppercase tracking-wider text-on-primary-container">
                        In Progress
                      </span>
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
                        {fmt1(data.currentLessonLast.accuracy)}% ACC{" "}
                        {data.currentLessonLast.accuracy >= 95
                          ? "(gate met)"
                          : "(NEEDS 95%)"}
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
                      Resume Lesson {moduleNumber(currentLesson.level, currentLesson.orderIndex)} (Enter)
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-space-lg pl-space-xl text-center">
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
                VIEW ALL →
              </button>
            </div>
            {recent.length === 0 ? (
              <p className="rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/50 px-space-base py-space-lg text-center font-code-sm text-code-sm text-outline">
                No attempts yet — finish your first lesson to populate the ledger.
              </p>
            ) : (
              <table className="w-full text-left font-code-md text-code-md">
                <thead>
                  <tr className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                    <th className="pb-2 pr-2 font-semibold">Module</th>
                    <th className="pb-2 pr-2 text-right font-semibold">WPM</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Accuracy</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Errors</th>
                    <th className="pb-2 pr-2 text-right font-semibold">Backsp</th>
                    <th className="pb-2 pr-2 text-center font-semibold">Result</th>
                    <th className="pb-2 text-right font-semibold">When</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((attempt) => (
                    <tr
                      key={attempt.id}
                      className="border-t border-surface-container-highest/30"
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
                        {resultChip(attempt.completed, attempt.wpm, attempt.accuracy)}
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
          {/* Daily goals (display-only until Phase 8) */}
          <section className="rounded-xl border border-surface-container-highest/40 bg-surface-container-low p-space-base shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-primary-container">
                  track_changes
                </span>
                Daily Goals
              </h3>
              <span className="font-code-sm text-code-sm font-bold text-outline">
                {fmtDayStamp(now)}
              </span>
            </div>
            <GoalBar
              icon="schedule"
              label="Training Time"
              valueText={`${fmtMinutes(today.minutes)} / ${DEFAULT_DAILY_GOALS.minutesGoal}m`}
              pct={(today.minutes / DEFAULT_DAILY_GOALS.minutesGoal) * 100}
            />
            <GoalBar
              icon="checklist"
              label="Lessons Done"
              valueText={`${today.lessonsDone} / ${DEFAULT_DAILY_GOALS.lessonsGoal}`}
              pct={(today.lessonsDone / DEFAULT_DAILY_GOALS.lessonsGoal) * 100}
            />
            <GoalBar
              icon="keyboard_command_key"
              label="Characters"
              valueText={`${fmtInt(today.charsTyped)} / ${fmtInt(DEFAULT_DAILY_GOALS.charsGoal)}`}
              pct={(today.charsTyped / DEFAULT_DAILY_GOALS.charsGoal) * 100}
            />
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-container-lowest px-space-sm py-1.5 font-code-sm text-code-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary-container">
                local_fire_department
              </span>
              <span>
                Streak: <strong className="font-bold text-primary">{streak.current} days</strong>{" "}
                • best {streak.best}
              </span>
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
          ALL SYSTEMS LOCAL // ZERO NETWORK DEPENDENCY
        </span>
        <span className="flex items-center gap-3">
          <DemoSeedButton />
          <span>
            DB: {data.dbSizeBytes !== null ? `${fmtInt(data.dbSizeBytes / 1024 / 1024)} MB` : "—"} • LAST
            BACKUP: —
          </span>
        </span>
      </footer>
    </main>
  );
}

/** Module cell of the recent-attempts table ("3.14 Struct Arrow & Member"). */
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

function GoalBar({
  icon,
  label,
  valueText,
  pct,
}: {
  icon: string;
  label: string;
  valueText: string;
  pct: number;
}) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="flex items-center justify-between font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[13px] text-primary-container">
            {icon}
          </span>
          {label}
        </span>
        <span className="text-on-surface">{valueText}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
        <div
          className="h-full rounded-full bg-gradient-to-r from-secondary-container via-primary-container to-primary"
          style={{ width: `${Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0))}%` }}
        />
      </div>
    </div>
  );
}
