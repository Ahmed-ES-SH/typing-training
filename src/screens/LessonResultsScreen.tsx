import { useEffect, useMemo, useRef, useState } from "react";

import { getLesson, nextLessonInOrder } from "../content";
import { attemptsRepo, customLessonsRepo } from "../lib/db/repositories";
import {
  ACCURACY_GATE,
  WPM_GATE,
  evaluateAttempt,
  evaluatePersonal,
  gradeFor,
  type Grade,
} from "../lib/curriculum/rules";
import type { AttemptRow } from "../lib/schemas";
import type { AttemptReportRow } from "../lib/schemas";
import type { CustomLesson } from "../lib/schemas";
import { customIdFromRef, toCurriculumLesson } from "../lib/customLessons/domain";
import { fmt1, fmtClock, moduleNumber } from "../lib/format";
import { getStreak, getTodayActuals } from "../lib/stats/dailyService";
import { buildMicroDrillPlan, stashMicroDrillReturn } from "../lib/intelligence/microDrill";
import { newDrillSeed } from "../lib/intelligence/drillService";
import { resultsActionFor } from "../lib/session/goldenLoop";
import { isEditableFocused } from "../lib/session/focusShield";
import { cn } from "../lib/cn";
import { useCurriculumStore } from "../stores/useCurriculumStore";
import { useDailyGoalsStore } from "../stores/useDailyGoalsStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Lesson Results screen — implemented from
 * `screens/lesson_results_typekernel/code.html` (with the shared TypeKernel
 * tokens; the mockup's raw slate/emerald hexes map to the nearest palette
 * colors). Shows the verdict + grade, threshold-delta metric cards, per-key
 * spotlight cards from the attempt's `key_report`, the attempt history strip
 * and the keyboard-first actions (UX plan §4.1.1 + §7.1): Enter =
 * Continue/Retry, Space = Replay/Retry, D = 45s Targeted Micro-Drill on the
 * missed keys, Ctrl+R = Retry, Esc = Curriculum.
 */

/* Number/time rendering comes from the shared `lib/format` util (Phase 8 §3.5). */

interface ResultsData {
  lessonId: string;
  attemptNumber: number;
  wpm: number;
  accuracy: number;
  errorCount: number;
  correctChars: number;
  incorrectChars: number;
  backspaceCount: number;
  durationMs: number;
  keyReport: AttemptReportRow["keyReport"];
  persisted: boolean;
}

/** Symbol chip name + description for the spotlight cards. */
const KEY_LABELS: Record<string, string> = {
  "-": "Hyphen / Minus", ">": "Greater-Than / Arrow", "<": "Less-Than",
  "(": "Open Paren", ")": "Close Paren", "{": "Open Brace", "}": "Close Brace",
  "[": "Open Bracket", "]": "Close Bracket", ":": "Colon", ";": "Semicolon",
  "_": "Underscore", "=": "Equals", "+": "Plus", "*": "Asterisk", "&": "Ampersand",
  "|": "Pipe", "/": "Slash", "\\": "Backslash", "!": "Bang", "?": "Question",
  "@": "At Sign", "#": "Hash", "$": "Dollar", "%": "Percent", '"': "Double Quote",
  "'": "Single Quote", "`": "Backtick", ".": "Period", ",": "Comma",
};

const GRADE_TONES: Record<Grade, string> = {
  S: "bg-primary-container/20 text-primary border-primary-container/40",
  A: "bg-primary-container/20 text-primary border-primary-container/40",
  B: "bg-secondary-container/20 text-secondary border-secondary-container/40",
  C: "bg-surface-container-high text-on-surface border-surface-container-highest",
  D: "bg-error-container/40 text-error border-error/40",
  F: "bg-error-container text-on-error-container border-error/40",
};

export default function LessonResultsScreen() {
  const params = useUiStore((s) => s.params["lesson-results"]);
  const summary = useSessionStore((s) => s.summary);
  const outcome = useSessionStore((s) => s.outcome);
  const persistError = useSessionStore((s) => s.persistError);
  const sessionLesson = useSessionStore((s) => s.lesson);
  const refresh = useCurriculumStore((s) => s.refresh);

  const [dbAttempt, setDbAttempt] = useState<AttemptReportRow | null>(null);
  const [history, setHistory] = useState<AttemptRow[]>([]);
  const [dbTried, setDbTried] = useState(false);
  /** §16: the custom module behind a `custom-<uuid>` attempt (null else). */
  const [customModule, setCustomModule] = useState<CustomLesson | null>(null);
  /** Footer telemetry — REAL streak + today's minutes against the goal. */
  const [streakDays, setStreakDays] = useState<number | null>(null);
  const [dailyTarget, setDailyTarget] = useState<{ done: number; goal: number } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [streak, actuals] = await Promise.all([
          getStreak(),
          getTodayActuals(),
        ]);
        if (cancelled) return;
        setStreakDays(streak.current);
        const goal = useDailyGoalsStore.getState().goals.minutesGoal;
        setDailyTarget({ done: Math.floor(actuals.minutes), goal });
      } catch {
        // DB unavailable — the footer degrades to "—".
        if (!cancelled) {
          setStreakDays(null);
          setDailyTarget(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve attempt data: DB row first, in-memory session summary as the
  // degraded fallback (plain-browser preview / failed persistence).
  useEffect(() => {
    let cancelled = false;
    setDbTried(false);
    (async () => {
      const attemptId = params?.attemptId ?? null;
      try {
        if (attemptId !== null) {
          const row = await attemptsRepo.getById(attemptId);
          if (!cancelled) setDbAttempt(row);
          if (row) {
            const hist = await attemptsRepo.historyFor(row.lessonId, 5);
            if (!cancelled) setHistory(hist);
          }
        } else if (summary !== null) {
          const hist = await attemptsRepo
            .historyFor(summary.lessonId, 5)
            .catch(() => []);
          if (!cancelled) setHistory(hist);
        }
      } catch {
        // DB unavailable — the in-memory fallback below still renders.
      } finally {
        if (!cancelled) setDbTried(true);
      }
    })();
    void refresh();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.attemptId]);

  // Load the custom module behind a `custom-<uuid>` attempt (§16).
  useEffect(() => {
    const lessonId = dbAttempt?.lessonId ?? summary?.lessonId ?? null;
    const customId = lessonId !== null ? customIdFromRef(lessonId) : null;
    if (customId === null) {
      setCustomModule(null);
      return;
    }
    let cancelled = false;
    void customLessonsRepo
      .get(customId)
      .then((row) => {
        if (!cancelled) setCustomModule(row);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dbAttempt, summary]);

  const data: ResultsData | null = useMemo(() => {
    if (dbAttempt) {
      return {
        lessonId: dbAttempt.lessonId,
        attemptNumber: dbAttempt.attemptNumber,
        wpm: dbAttempt.wpm,
        accuracy: dbAttempt.accuracy,
        errorCount: dbAttempt.errorCount,
        correctChars: dbAttempt.correctChars,
        incorrectChars: dbAttempt.incorrectChars,
        backspaceCount: dbAttempt.backspaceCount,
        durationMs: dbAttempt.durationMs,
        keyReport: dbAttempt.keyReport,
        persisted: true,
      };
    }
    if (summary) {
      return {
        lessonId: summary.lessonId,
        attemptNumber: summary.attemptNumber,
        wpm: summary.wpm,
        accuracy: summary.accuracy,
        errorCount: summary.errorCount,
        correctChars: summary.correctChars,
        incorrectChars: summary.incorrectChars,
        backspaceCount: summary.backspaceCount,
        durationMs: summary.durationMs,
        keyReport: null,
        persisted: false,
      };
    }
    return null;
  }, [dbAttempt, summary]);

  const lesson = data
    ? data.lessonId.startsWith("custom-") && customModule !== null
      ? toCurriculumLesson(customModule)
      : (getLesson(data.lessonId) ?? sessionLesson)
    : sessionLesson;

  const isCustom = (data?.lessonId.startsWith("custom-") ?? false) || lesson?.source === "custom";

  // §16 optional personal targets — display-only (never a lock).
  const personal = isCustom
    ? {
        wpm: customModule?.wpmTarget ?? null,
        accuracy: customModule?.accuracyTarget ?? null,
      }
    : null;

  const verdict = useMemo(() => {
    // §16: the store outcome carries the §8 curriculum verdict, and for a
    // custom module `completeCustomAttempt` hardcodes PASS — so it must
    // never reach the paint for custom lessons. Skipping it here makes the
    // fresh-completion path take the personal-target branch below, exactly
    // like the history path (outcome null) always did.
    if (outcome && !isCustom) return outcome;
    if (data) {
      const input = { completed: true, accuracy: data.accuracy, wpm: data.wpm };
      if (isCustom) {
        // Custom modules: verdict against personal targets, never the §8
        // gate; null when the module defines no targets at all.
        const personalVerdict = evaluatePersonal(
          input,
          customModule?.wpmTarget ?? null,
          customModule?.accuracyTarget ?? null,
        );
        return {
          attempt: null,
          verdict: personalVerdict,
          grade: gradeFor(input),
          nextLessonId: null,
        };
      }
      return {
        attempt: null,
        verdict: evaluateAttempt(input),
        grade: gradeFor(input),
        nextLessonId: evaluateAttempt(input) === "PASS"
          ? (nextLessonInOrder(data.lessonId)?.id ?? null)
          : null,
      };
    }
    return null;
  }, [outcome, data, isCustom, customModule]);

  /** §7.1 — double-press shield while the micro-drill plan is launching. */
  const launchingRef = useRef(false);
  const [drillLaunchError, setDrillLaunchError] = useState<string | null>(null);

  /**
   * §7.1 — the worst missed keys behind the Targeted Micro-Drill card:
   * ≥ 2 incorrect presses, worst-first, ties broken by lower accuracy,
   * capped at the plan's 3 displayed chars.
   */
  const drillCandidates = useMemo(() => {
    const report = data?.keyReport ?? null;
    if (report === null) return [];
    const accuracyOf = (entry: { totalPresses: number; incorrectPresses: number }): number =>
      entry.totalPresses > 0
        ? (entry.totalPresses - entry.incorrectPresses) / entry.totalPresses
        : 1;
    return report
      .filter((entry) => entry.incorrectPresses >= 2)
      .sort((a, b) => b.incorrectPresses - a.incorrectPresses || accuracyOf(a) - accuracyOf(b))
      .slice(0, 3);
  }, [data]);

  // Actions: Esc -> lesson list, Ctrl+R -> Retry, Enter -> Continue (pass) /
  // Retry (otherwise) — matching the primary button.
  const navigateLessons = () =>
    useUiStore.getState().navigate(isCustom ? "custom-lessons" : "lessons");
  const retryLesson = () => {
    const id = lesson?.id;
    if (id === undefined) return;
    // Custom modules are not in the bundled curriculum — navigate directly;
    // the session screen resolves the `custom-<uuid>` ref from the DB.
    if (isCustom) {
      useSessionStore.getState().reset();
      useUiStore.getState().navigate("typing-session", {
        "typing-session": { lessonId: id },
      });
    } else {
      useCurriculumStore.getState().startLesson(id);
    }
  };
  const nextLesson = () => {
    const id = verdict?.nextLessonId ?? null;
    if (id) useCurriculumStore.getState().startLesson(id);
  };

  /**
   * §7.1 — `D` (or the card's button): build the ephemeral plan over the
   * missed keys, stash the return-to-results hint, then hand the drill to
   * the session store's normal `kind='weakness'` pipeline (attempt rows and
   * key rollups happen there; curriculum unlock gates stay untouched) and
   * jump to the Weakness screen.
   */
  const launchMicroDrill = async () => {
    if (launchingRef.current || drillCandidates.length === 0) return;
    launchingRef.current = true;
    setDrillLaunchError(null);
    try {
      const plan = buildMicroDrillPlan(
        drillCandidates.map((entry) => entry.key),
        newDrillSeed(),
        lesson?.level ?? 1,
      );
      await useSessionStore.getState().startDrill(plan);
      stashMicroDrillReturn({
        attemptId: params?.attemptId ?? null,
        planId: plan.sets[0]?.id,
      });
      useUiStore.getState().navigate("weakness-training");
    } catch (err) {
      setDrillLaunchError(
        err instanceof Error ? err.message : "Failed to start the micro-drill",
      );
      launchingRef.current = false;
    }
  };

  // UX plan §4.1.1 "Smart Enter" + §7.1 Micro-Drill: the primary action key
  // NEVER dead-ends — Enter advances on PASS and instantly retries on FAIL,
  // Space always replays the current lesson (beating the personal best on a
  // pass), Esc returns to the curriculum and D launches the targeted
  // micro-drill. Registered on every render so the verdict/attempt data of
  // the current paint is what the handler sees.
  useEffect(() => {
    const canGoNext = verdict?.verdict === "PASS" && verdict.nextLessonId !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      // §4.1.4 focus shield: an editable field keeps its keystrokes.
      if (isEditableFocused()) return;
      // A button/link the user deliberately focused (Tab or click) keeps its
      // Space/Enter — bail out instead of blurring it, so "Retry save" /
      // "Drill missed keys" activate rather than firing a screen action.
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement) return;
      // Defence in depth: a global hotkey that already claimed this key wins.
      if (event.defaultPrevented === true) return;
      // A launch in flight owns the flow — swallow keys until it navigates.
      if (launchingRef.current) return;

      const action = resultsActionFor(event, {
        canAdvance: canGoNext,
        hasAttempt: data !== null,
        canDrill: drillCandidates.length > 0,
      });
      if (action === null) return;
      event.preventDefault();
      if (action === "curriculum") navigateLessons();
      else if (action === "next-lesson") nextLesson();
      else if (action === "drill-micro") void launchMicroDrill();
      else retryLesson();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /* ------------------------------ states ------------------------------ */

  if (data === null) {
    return (
      <main className="flex w-full flex-1 items-center justify-center bg-surface p-space-lg">
        <div className="max-w-md rounded-xl bg-surface-container-low p-space-lg text-center shadow-xl">
          <span className="material-symbols-outlined text-[36px] text-on-surface-variant">
            fact_check
          </span>
          <h2 className="mt-2 font-headline-lg text-headline-lg text-on-surface">
            No Attempt to Report
          </h2>
          <p className="mt-1 font-body-md text-body-md text-on-surface-variant">
            {dbTried
              ? "Finish a typing session to see its results here."
              : "Loading attempt…"}
          </p>
          <button
            type="button"
            onClick={navigateLessons}
            className="mt-space-base rounded-lg bg-primary-container px-space-lg py-2 font-label-md font-bold text-label-md text-on-primary-container hover:bg-tertiary-container"
          >
            Browse lessons (Esc)
          </button>
        </div>
      </main>
    );
  }

  const passed = verdict?.verdict === "PASS";
  /** §16 — a custom module with no personal targets has no verdict at all. */
  const targetUnset = isCustom && verdict !== null && verdict.verdict === null;
  const grade = verdict?.grade ?? "F";
  const nextLessonInfo = verdict?.nextLessonId ? getLesson(verdict.nextLessonId) : null;
  /** The large primary action is Continue when a next lesson unlocked, else Retry. */
  const canContinue = passed && nextLessonInfo !== null;
  const moduleNo = isCustom
    ? "CUSTOM"
    : lesson
      ? moduleNumber(lesson.level, lesson.orderIndex)
      : data.lessonId;
  // §16: the threshold line shows the module's OPTIONAL personal targets;
  // null = dimension not evaluated (the §8 gate never applies here).
  const wpmTarget = personal !== null ? personal.wpm : WPM_GATE;
  const accTarget = personal !== null ? personal.accuracy : ACCURACY_GATE;
  const expectedMs = lesson
    ? (lesson.content.replace(/\n/g, "").length /
        ((wpmTarget ?? 30) * 5)) *
      60_000
    : data.durationMs;
  const wpmDelta = wpmTarget === null ? null : data.wpm - wpmTarget;
  const accDelta = accTarget === null ? null : data.accuracy - accTarget;

  return (
    <main className="flex w-full flex-1 flex-col items-center overflow-y-auto bg-surface p-6 md:p-10">
      <div className="flex w-full max-w-5xl flex-col">
        {/* Breadcrumb */}
        <div className="mb-6 flex w-full items-center justify-between px-1 font-code-sm text-code-sm text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-primary-container/30 bg-primary-container/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {isCustom
                ? "Custom lesson"
                : `Level ${String(lesson?.level ?? 0).padStart(2, "0")} • Lesson ${moduleNo}`}
            </span>
            <span className="text-outline-variant">/</span>
            <span className="font-medium text-on-surface">{lesson?.title ?? data.lessonId}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Attempt #{String(data.attemptNumber).padStart(2, "0")}</span>
            <span className="text-outline-variant">•</span>
            <span
              className={cn(
                "flex items-center gap-1",
                passed
                  ? "text-secondary"
                  : targetUnset
                    ? "text-on-surface-variant"
                    : "text-error",
              )}
            >
              <span className="material-symbols-outlined text-[14px]">
                {passed ? "check_circle" : targetUnset ? "radio_button_unchecked" : "cancel"}
              </span>
              {passed ? (
                isCustom ? "Personal target met" : "Passed"
              ) : targetUnset ? (
                "No personal target"
              ) : isCustom ? (
                "Target not met"
              ) : (
                "Not passed"
              )}
            </span>
          </div>
        </div>

        {/* Main results card */}
        <div className="relative w-full overflow-hidden rounded-2xl border border-surface-container-highest/60 bg-surface-container-lowest p-8 shadow-2xl">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary-container/10 blur-3xl" />

          {/* Verdict hero */}
          <div className="flex flex-col justify-between gap-6 border-b border-surface-container-highest/50 pb-8 md:flex-row md:items-center">
            <div className="flex items-center gap-5">
              <div
                className={cn(
                  "flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border",
                  passed
                    ? "border-secondary/30 bg-secondary-container/20 text-secondary"
                    : "border-primary-container/30 bg-primary-container/10 text-primary",
                )}
              >
                <span className="material-symbols-outlined text-[40px]">
                  {passed ? "check" : "refresh"}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="font-headline-xl text-headline-xl tracking-tight text-on-surface">
                    {isCustom
                      ? "Lesson Complete"
                      : passed
                        ? "Passed!"
                        : "Keep practicing"}
                  </h1>
                  {/* §16 — "Grade F" is a §8-gate artifact: with no personal
                      targets there is no verdict to grade, so the pill would
                      contradict the "No personal target" chip beside it. */}
                  {!targetUnset && (
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        GRADE_TONES[grade],
                      )}
                    >
                      Grade {grade}
                    </span>
                  )}
                </div>
                <p className="mt-1 flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant">
                  <span
                    className={cn(
                      "material-symbols-outlined text-[16px]",
                      targetUnset ? "text-on-surface-variant" : "text-secondary",
                    )}
                  >
                    {passed ? "lock_open" : targetUnset ? "radio_button_unchecked" : "lock"}
                  </span>
                  <span>
                        {isCustom ? (
                          customModule !== null &&
                          customModule.wpmTarget === null &&
                          customModule.accuracyTarget === null ? (
                            "No personal targets on this lesson — practice freely."
                          ) : (
                            "Personal targets are display-only — they never gate progress."
                          )
                        ) : (
                          <>
                            {passed && nextLessonInfo
                              ? "Next unlocked: "
                              : passed
                                ? "Final lesson cleared — nothing left to unlock"
                                : "Repeat this lesson to unlock the next one. "}
                            {passed && nextLessonInfo && (
                              <span className="font-code-sm font-semibold text-on-surface">
                                Lesson {nextLessonInfo.level}.
                                {String(nextLessonInfo.orderIndex + 1).padStart(2, "0")} •{" "}
                                {nextLessonInfo.title}
                              </span>
                            )}
                            {!passed && (
                              <span className="font-code-sm text-on-surface-variant">
                                Needs accuracy &gt;= {ACCURACY_GATE}% AND speed &gt; {WPM_GATE} WPM in the
                                same attempt
                              </span>
                            )}
                          </>
                        )}
                  </span>
                </p>
              </div>
            </div>

            {/* Attempt counter + threshold */}
            <div className="flex items-center gap-3 font-code-sm self-start md:self-center">
              <div className="rounded-xl border border-white/5 bg-surface-container-low px-4 py-2 text-right">
                <span className="block text-xs font-medium text-on-surface-variant">
                  Attempt
                </span>
                <span className="font-headline-md text-lg font-bold text-on-surface">
                  {data.attemptNumber}
                </span>
              </div>
              <div className="rounded-xl border border-white/5 bg-surface-container-low px-4 py-2 text-right">
                <span className="block text-xs font-medium text-on-surface-variant">
                  {isCustom ? "Personal target" : "Target"}
                </span>
                <span className="font-code-sm text-code-sm font-semibold text-on-surface">
                  {wpmTarget === null && accTarget === null
                    ? "no target"
                    : `> ${wpmTarget ?? "—"} WPM / ${accTarget === null ? "—" : `${accTarget}%`}`}
                </span>
              </div>
            </div>
          </div>

          {/* Metric cards with threshold deltas */}
          <div className="grid grid-cols-2 gap-4 py-8 lg:grid-cols-4">
            <div className="group rounded-xl border border-white/5 bg-surface-container-low/60 p-4 transition-colors hover:border-primary-container/40">
              <span className="mb-1 block text-xs font-medium text-on-surface-variant">
                Speed
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-code-lg text-3xl font-bold tracking-tight text-on-surface">
                  {fmt1(data.wpm)}
                </span>
                <span className="text-xs text-on-surface-variant">WPM</span>
              </div>
              <div
                className={cn(
                  "mt-2.5 flex items-center gap-1.5 text-xs",
                  wpmDelta === null
                    ? "text-on-surface-variant"
                    : wpmDelta > 0
                      ? "text-primary"
                      : "text-error",
                )}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {wpmDelta === null ? "info" : wpmDelta > 0 ? "trending_up" : "trending_down"}
                </span>
                <span>
                  {wpmDelta === null
                    ? "no WPM target on this lesson"
                    : `${wpmDelta > 0 ? "+" : ""}${fmt1(wpmDelta)} vs target (> ${wpmTarget})`}
                </span>
              </div>
            </div>

            <div
              className={cn(
                "group rounded-xl border bg-surface-container-low/60 p-4 transition-colors",
                // §16 — with no accuracy target the card is neutral, exactly
                // like the Speed card: only a real miss earns the error tint.
                accDelta === null || passed
                  ? "border-white/5 hover:border-secondary/40"
                  : "border-error/20",
              )}
            >
              <span className="mb-1 block text-xs font-medium text-on-surface-variant">
                Accuracy
              </span>
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "font-code-lg text-3xl font-bold tracking-tight",
                    accDelta === null
                      ? "text-on-surface"
                      : passed
                        ? "text-secondary"
                        : "text-error",
                  )}
                >
                  {fmt1(data.accuracy)}
                </span>
                <span className="text-xs text-on-surface-variant">%</span>
              </div>
              <div
                className={cn(
                  "mt-2.5 flex items-center gap-1.5 text-xs",
                  accDelta === null
                    ? "text-on-surface-variant"
                    : accDelta >= 0
                      ? "text-secondary"
                      : "text-error",
                )}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {accDelta === null ? "info" : accDelta >= 0 ? "check_circle" : "error"}
                </span>
                <span>
                  {accDelta === null
                    ? "no accuracy target on this lesson"
                    : `${accDelta >= 0 ? "+" : ""}${fmt1(accDelta)}% vs target (${accTarget}%)`}
                </span>
              </div>
            </div>

            <div className="group rounded-xl border border-white/5 bg-surface-container-low/60 p-4 transition-colors hover:border-white/10">
              <span className="mb-1 block text-xs font-medium text-on-surface-variant">
                Time
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-code-lg text-3xl font-bold tracking-tight text-on-surface">
                  {fmtClock(data.durationMs)}
                </span>
              </div>
              <div className="mt-2.5 text-xs text-on-surface-variant">
                <span>
                  Expected at {wpmTarget === null ? "30" : wpmTarget} WPM: ~{fmtClock(expectedMs)}
                </span>
              </div>
            </div>

            <div className="group rounded-xl border border-white/5 bg-surface-container-low/60 p-4 transition-colors hover:border-white/10">
              <span className="mb-1 block text-xs font-medium text-on-surface-variant">
                Errors
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-code-lg text-3xl font-bold tracking-tight text-error">
                  {data.errorCount}
                </span>
                <span className="text-xs text-on-surface-variant">
                  / {data.backspaceCount} backspaces
                </span>
              </div>
              <div className="mt-2.5 text-xs text-on-surface-variant">
                <span>
                  {data.correctChars} correct / {data.incorrectChars} incorrect chars
                </span>
              </div>
            </div>
          </div>

          {/* Missed keys — clean rounded chips */}
          {data.keyReport && data.keyReport.length > 0 && (
            <div className="border-b border-white/5 pb-8 pt-2">
              <span className="mb-3 block text-xs font-medium text-on-surface-variant">
                {data.keyReport.some((entry) => entry.incorrectPresses > 0)
                  ? "Missed keys"
                  : "Key focus"}
              </span>
              <div className="flex flex-wrap gap-2">
                {data.keyReport.slice(0, 6).map((entry) => {
                  const accuracyPct =
                    entry.totalPresses > 0
                      ? ((entry.totalPresses - entry.incorrectPresses) / entry.totalPresses) * 100
                      : 100;
                  return (
                    <span
                      key={`${entry.key}-${entry.shiftRequired ? "s" : "b"}`}
                      title={`${entry.totalPresses} presses • ${Math.round(entry.avgLatencyMs)}ms average`}
                      className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-surface-container-low px-3 py-1.5 text-xs text-on-surface-variant"
                    >
                      <span
                        className={cn(
                          "flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-mono text-[11px] font-semibold",
                          entry.incorrectPresses > 0
                            ? "bg-error-container/30 text-error"
                            : "bg-surface-container-high text-on-surface",
                        )}
                      >
                        {entry.key}
                      </span>
                      <span>{KEY_LABELS[entry.key] ?? "Character"}</span>
                      {entry.incorrectPresses > 0 && (
                        <span className="font-medium text-error">
                          {entry.incorrectPresses} miss
                          {entry.incorrectPresses > 1 ? "es" : ""}
                        </span>
                      )}
                      <span
                        className={cn(
                          "font-semibold",
                          accuracyPct === 100 ? "text-secondary" : "text-error",
                        )}
                      >
                        {fmt1(accuracyPct)}%
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* §7.1 Targeted Micro-Drill — 1-click 45s drill on the worst keys */}
          {drillCandidates.length > 0 && (
            <div className="border-b border-white/5 pb-8 pt-2">
              <span className="mb-3 block text-xs font-medium text-on-surface-variant">
                Targeted Micro-Drill
              </span>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/40 bg-primary-container/10 p-4 ring-1 ring-primary/20">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-label-md text-label-md font-bold text-on-surface">
                    <span className="material-symbols-outlined text-[18px] text-primary">
                      bolt
                    </span>
                    <span>Fix your worst keys in 45 seconds</span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {drillCandidates.map((entry) => {
                      const errPct =
                        entry.totalPresses > 0
                          ? Math.round((entry.incorrectPresses / entry.totalPresses) * 100)
                          : 0;
                      return (
                        <span
                          key={`${entry.key}-${entry.shiftRequired ? "s" : "b"}`}
                          title={`${entry.incorrectPresses} misses of ${entry.totalPresses} presses`}
                          className="inline-flex items-center gap-2 rounded-lg border border-error/30 bg-error-container/30 px-2.5 py-1 font-code-sm text-code-sm text-on-surface"
                        >
                          <span className="flex h-6 min-w-6 items-center justify-center rounded bg-surface-container-lowest px-1.5 font-mono text-[12px] font-bold text-error">
                            {entry.key === " "
                              ? "␣"
                              : entry.key === "\n"
                                ? "⏎"
                                : entry.key}
                          </span>
                          <span className="font-semibold text-error">{errPct}% err</span>
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 font-code-sm text-code-sm text-on-surface-variant">
                    <span>Press</span>
                    <kbd className="rounded border border-white/15 bg-surface-container-low px-1.5 py-0.5 text-[11px] font-bold text-on-surface">
                      D
                    </kbd>
                    <span>to Drill (45s)</span>
                  </p>
                </div>
                {/* Same action as the `D` binding — one gesture, two paths. */}
                <button
                  type="button"
                  onClick={() => void launchMicroDrill()}
                  className="flex items-center gap-2 rounded-xl bg-primary-container px-5 py-2.5 text-sm font-semibold text-on-primary-container shadow-lg shadow-primary-container/40 ring-1 ring-primary/40 transition-all hover:bg-tertiary-container"
                >
                  <span className="material-symbols-outlined text-[18px]">gps_fixed</span>
                  <span>Drill missed keys</span>
                  <kbd className="rounded border border-on-primary-container/40 bg-on-primary-container/20 px-1.5 py-0.5 text-[11px]">
                    D
                  </kbd>
                </button>
              </div>
              {drillLaunchError !== null && (
                <p className="mt-2 font-code-sm text-code-sm text-error">{drillLaunchError}</p>
              )}
            </div>
          )}

          {/* Attempt history strip (comparison with previous attempts) */}
          {history.length > 1 && (
            <div className="border-b border-white/5 py-6">
              <span className="mb-3 block text-xs font-medium text-on-surface-variant">
                Recent attempts
              </span>
              <div className="flex flex-wrap gap-space-sm">
                {[...history].reverse().map((attempt) => {
                  const attemptInput = {
                    completed: attempt.completed,
                    accuracy: attempt.accuracy,
                    wpm: attempt.wpm,
                  };
                  // §16 — custom lessons grade against their OPTIONAL personal
                  // targets (null = no target, exactly like the verdict memo
                  // above), never the §8 curriculum gate: an unpreset module
                  // must not paint "Not passed" beside the "No personal
                  // target" chip.
                  const attemptVerdict = isCustom
                    ? evaluatePersonal(
                        attemptInput,
                        customModule?.wpmTarget ?? null,
                        customModule?.accuracyTarget ?? null,
                      )
                    : evaluateAttempt(attemptInput);
                  return (
                    <div
                      key={attempt.id}
                      className={cn(
                        "flex items-center gap-3 rounded-full border px-3 py-1.5 text-xs",
                        attempt.id === (dbAttempt?.id ?? -1)
                          ? "border-primary-container/50 bg-primary-container/10 text-primary"
                          : "border-white/5 bg-surface-container-low text-on-surface-variant",
                      )}
                    >
                      <span className="font-semibold">Attempt {attempt.attemptNumber}</span>
                      <span>{fmt1(attempt.wpm)} WPM</span>
                      <span>{fmt1(attempt.accuracy)}%</span>
                      <span
                        className={cn(
                          "font-semibold",
                          attemptVerdict === "PASS"
                            ? "text-secondary"
                            : attemptVerdict === "FAIL"
                              ? "text-error"
                              : "text-on-surface-variant",
                        )}
                      >
                        {attemptVerdict === "PASS"
                          ? "Passed"
                          : attemptVerdict === "FAIL"
                            ? "Not passed"
                            : "No target"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions with keyboard shortcuts */}
          <div className="flex flex-col items-center justify-between gap-4 pt-6 sm:flex-row">
            <div className="flex w-full items-center gap-3 sm:w-auto">
              <button
                type="button"
                onClick={navigateLessons}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-surface-container px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface sm:w-auto"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                <span>All lessons</span>
                <kbd className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[11px] text-on-surface-variant">
                  Esc
                </kbd>
              </button>
              {!canContinue && (
                <button
                  type="button"
                  onClick={retryLesson}
                  className="hidden items-center justify-center gap-2 rounded-xl border border-white/10 bg-surface-container px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface sm:flex"
                >
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                  <span>Retry</span>
                  <kbd className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[11px] text-on-surface-variant">
                    Ctrl+R
                  </kbd>
                </button>
              )}
              {/* UX plan §4.1.1 — Space is the always-live secondary action:
                  replay for a personal best on PASS, instant retry on FAIL. */}
              <button
                type="button"
                onClick={retryLesson}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-surface-container px-4 py-2.5 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface sm:w-auto"
              >
                <span className="material-symbols-outlined text-[16px]">replay</span>
                <span>{canContinue ? "Replay" : "Retry"}</span>
                <kbd className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[11px] text-on-surface-variant">
                  Space
                </kbd>
              </button>
            </div>

            <button
              type="button"
              onClick={canContinue ? nextLesson : retryLesson}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-primary-container px-7 py-3 text-sm font-semibold text-on-primary-container shadow-lg shadow-primary-container/45 ring-1 ring-primary/40 transition-all hover:bg-tertiary-container sm:w-auto"
            >
              <span>{canContinue ? "Continue" : "Retry"}</span>
              <kbd className="rounded border border-on-primary-container/40 bg-on-primary-container/20 px-2 py-0.5 text-[11px] text-on-primary-container">
                Enter
              </kbd>
            </button>
          </div>
        </div>

        {/* Footer telemetry note */}
        <div className="mt-6 flex w-full items-center justify-between px-2 font-code-sm text-[11px] text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                persistError === null ? "bg-secondary" : "bg-error",
              )}
            />
            <span>
              {persistError === null
                ? "Saved to history"
                : `Not saved: ${persistError}`}
            </span>
            {persistError !== null && (
              <button
                type="button"
                onClick={() => void useSessionStore.getState().retryPersist()}
                className="rounded bg-surface-container px-2 py-0.5 font-bold text-on-surface hover:bg-surface-container-high"
              >
                Retry save
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>
              Streak:{" "}
              <strong className="font-bold text-primary">
                {streakDays !== null && streakDays > 0
                  ? `${streakDays} Day${streakDays === 1 ? "" : "s"}`
                  : "—"}
              </strong>
            </span>
            <span className="text-outline-variant">•</span>
            <span>
              Daily Target:{" "}
              <strong className="text-on-surface">
                {dailyTarget !== null && dailyTarget.goal > 0
                  ? `${dailyTarget.done} / ${dailyTarget.goal} min`
                  : "— / — min"}
              </strong>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
