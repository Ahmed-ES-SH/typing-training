import { useEffect, useMemo, useState } from "react";

import { getLesson, nextLessonInOrder } from "../content";
import { attemptsRepo } from "../lib/db/repositories";
import {
  ACCURACY_GATE,
  WPM_GATE,
  evaluateAttempt,
  gradeFor,
  type Grade,
} from "../lib/curriculum/rules";
import type { AttemptRow } from "../lib/schemas";
import type { AttemptReportRow } from "../lib/schemas";
import { cn } from "../lib/cn";
import { useCurriculumStore } from "../stores/useCurriculumStore";
import { useSessionStore } from "../stores/useSessionStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Lesson Results screen — implemented from
 * `screens/lesson_results_typekernel/code.html` (with the shared TypeKernel
 * tokens; the mockup's raw slate/emerald hexes map to the nearest palette
 * colors). Shows the verdict + grade, threshold-delta metric cards, per-key
 * spotlight cards from the attempt's `key_report`, the attempt history strip
 * and the Esc / Ctrl+R / Enter shortcut actions.
 */

const fmt1 = (value: number): string => value.toFixed(1);

const fmtClock = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

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

  const lesson = data ? (getLesson(data.lessonId) ?? sessionLesson) : sessionLesson;

  const verdict = useMemo(() => {
    if (outcome) return outcome;
    if (data) {
      const input = { completed: true, accuracy: data.accuracy, wpm: data.wpm };
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
  }, [outcome, data]);

  // Actions: Esc -> Lessons, Ctrl+R -> Retry, Enter -> Next (pass only).
  const navigateLessons = () => useUiStore.getState().navigate("lessons");
  const retryLesson = () => {
    const id = lesson?.id;
    if (id) useCurriculumStore.getState().startLesson(id);
  };
  const nextLesson = () => {
    const id = verdict?.nextLessonId ?? null;
    if (id) useCurriculumStore.getState().startLesson(id);
  };

  useEffect(() => {
    const canGoNext = verdict?.verdict === "PASS" && verdict.nextLessonId !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        navigateLessons();
      } else if (event.ctrlKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        retryLesson();
      } else if (event.key === "Enter" && canGoNext) {
        event.preventDefault();
        nextLesson();
      }
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
            Browse Lessons [Esc]
          </button>
        </div>
      </main>
    );
  }

  const passed = verdict?.verdict === "PASS";
  const grade = verdict?.grade ?? "F";
  const nextLessonInfo = verdict?.nextLessonId ? getLesson(verdict.nextLessonId) : null;
  const moduleNo = lesson
    ? `${lesson.level}.${String(lesson.orderIndex + 1).padStart(2, "0")}`
    : data.lessonId;
  const expectedMs = lesson
    ? (lesson.content.replace(/\n/g, "").length / (WPM_GATE * 5)) * 60_000
    : data.durationMs;
  const wpmDelta = data.wpm - WPM_GATE;
  const accDelta = data.accuracy - ACCURACY_GATE;

  return (
    <main className="flex w-full flex-1 flex-col items-center overflow-y-auto bg-surface p-6 md:p-10">
      <div className="flex w-full max-w-5xl flex-col">
        {/* Breadcrumb */}
        <div className="mb-6 flex w-full items-center justify-between px-1 font-code-sm text-code-sm text-on-surface-variant">
          <div className="flex items-center gap-2">
            <span className="rounded border border-primary-container/30 bg-primary-container/10 px-2 py-0.5 font-code-sm text-[11px] font-semibold uppercase tracking-wide text-primary">
              Track {String(lesson?.level ?? 0).padStart(2, "0")} • Module {moduleNo}
            </span>
            <span className="text-outline-variant">/</span>
            <span className="font-medium text-on-surface">{lesson?.title ?? data.lessonId}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Session ID: #{String(data.attemptNumber).padStart(2, "0")}</span>
            <span className="text-outline-variant">•</span>
            <span
              className={cn(
                "flex items-center gap-1",
                passed ? "text-secondary" : "text-error",
              )}
            >
              <span className="material-symbols-outlined text-[14px]">
                {passed ? "check_circle" : "cancel"}
              </span>
              {passed ? "Requirement Satisfied" : "Requirement Not Met"}
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
                    : "border-error/40 bg-error-container/30 text-error",
                )}
              >
                <span className="material-symbols-outlined text-[40px]">
                  {passed ? "check" : "close"}
                </span>
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1
                    className={cn(
                      "font-headline-xl text-headline-xl tracking-tight",
                      passed ? "text-on-surface" : "text-error",
                    )}
                  >
                    {passed ? "Lesson Passed" : "Lesson Failed"}
                  </h1>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 font-code-sm text-code-sm font-bold tracking-wider",
                      GRADE_TONES[grade],
                    )}
                  >
                    GRADE {grade}
                  </span>
                </div>
                <p className="mt-1 flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant">
                  <span className="material-symbols-outlined text-[16px] text-secondary">
                    {passed ? "lock_open" : "lock"}
                  </span>
                  <span>
                    {passed && nextLessonInfo
                      ? "Next unlocked: "
                      : passed
                        ? "Final module cleared — nothing left to unlock"
                        : "Repeat this module to unlock the next one. "}
                    {passed && nextLessonInfo && (
                      <span className="font-code-sm font-semibold text-on-surface">
                        Module {nextLessonInfo.level}.
                        {String(nextLessonInfo.orderIndex + 1).padStart(2, "0")} •{" "}
                        {nextLessonInfo.title}
                      </span>
                    )}
                    {!passed && (
                      <span className="font-code-sm text-on-surface-variant">
                        Needs acc &gt;= {ACCURACY_GATE}% AND wpm &gt; {WPM_GATE} in the same attempt
                      </span>
                    )}
                  </span>
                </p>
              </div>
            </div>

            {/* Attempt counter + threshold */}
            <div className="flex items-center gap-3 font-code-sm self-start md:self-center">
              <div className="rounded-xl border border-surface-container-highest/60 bg-surface-container-low px-4 py-2 text-right">
                <span className="block font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                  Attempt #
                </span>
                <span className="font-headline-md text-lg font-bold text-on-surface">
                  {data.attemptNumber}
                </span>
              </div>
              <div className="rounded-xl border border-surface-container-highest/60 bg-surface-container-low px-4 py-2 text-right">
                <span className="block font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                  Target Threshold
                </span>
                <span className="font-code-sm text-code-sm font-semibold text-on-surface">
                  &gt; {WPM_GATE} WPM / {ACCURACY_GATE}%
                </span>
              </div>
            </div>
          </div>

          {/* Metric cards with threshold deltas */}
          <div className="grid grid-cols-2 gap-4 py-8 lg:grid-cols-4">
            <div className="group relative rounded-xl border border-surface-container-highest/60 bg-surface-container-low p-5 transition-colors hover:border-primary-container/40">
              <span className="mb-1 block font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
                Typing Speed
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-code-lg text-4xl font-extrabold tracking-tight text-on-surface">
                  {fmt1(data.wpm)}
                </span>
                <span className="font-code-sm font-semibold text-on-surface-variant">WPM</span>
              </div>
              <div
                className={cn(
                  "mt-2.5 flex items-center gap-1.5 font-code-sm text-code-sm",
                  wpmDelta > 0 ? "text-primary" : "text-error",
                )}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {wpmDelta > 0 ? "trending_up" : "trending_down"}
                </span>
                <span>
                  {wpmDelta > 0 ? "+" : ""}
                  {fmt1(wpmDelta)} vs gate (&gt; {WPM_GATE})
                </span>
              </div>
            </div>

            <div
              className={cn(
                "group relative rounded-xl border bg-surface-container-low p-5 transition-colors",
                passed
                  ? "border-surface-container-highest/60 hover:border-secondary/40"
                  : "border-error/30",
              )}
            >
              <span className="mb-1 block font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
                Accuracy
              </span>
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "font-code-lg text-4xl font-extrabold tracking-tight",
                    passed ? "text-secondary" : "text-error",
                  )}
                >
                  {fmt1(data.accuracy)}
                </span>
                <span className="font-code-sm font-semibold text-on-surface-variant">%</span>
              </div>
              <div
                className={cn(
                  "mt-2.5 flex items-center gap-1.5 font-code-sm text-code-sm",
                  accDelta >= 0 ? "text-secondary" : "text-error",
                )}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {accDelta >= 0 ? "check_circle" : "error"}
                </span>
                <span>
                  {accDelta >= 0 ? "+" : ""}
                  {fmt1(accDelta)}% vs threshold ({ACCURACY_GATE}%)
                </span>
              </div>
            </div>

            <div className="group relative rounded-xl border border-surface-container-highest/60 bg-surface-container-low p-5 transition-colors hover:border-surface-container-highest">
              <span className="mb-1 block font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
                Time Elapsed
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-code-lg text-4xl font-extrabold tracking-tight text-on-surface">
                  {fmtClock(data.durationMs)}
                </span>
              </div>
              <div className="mt-2.5 font-code-sm text-code-sm text-on-surface-variant">
                <span>Expected at gate speed: ~{fmtClock(expectedMs)}</span>
              </div>
            </div>

            <div className="group relative rounded-xl border border-surface-container-highest/60 bg-surface-container-low p-5 transition-colors hover:border-surface-container-highest">
              <span className="mb-1 block font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
                Mistakes &amp; Fixes
              </span>
              <div className="flex items-baseline gap-2">
                <span className="font-code-lg text-4xl font-extrabold tracking-tight text-error">
                  {data.errorCount}
                </span>
                <span className="font-code-sm text-on-surface-variant">
                  / {data.backspaceCount} backspaces
                </span>
              </div>
              <div className="mt-2.5 font-code-sm text-code-sm text-on-surface-variant">
                <span>
                  {data.correctChars} correct / {data.incorrectChars} incorrect chars
                </span>
              </div>
            </div>
          </div>

          {/* Key spotlight cards */}
          {data.keyReport && data.keyReport.length > 0 && (
            <div className="grid grid-cols-1 gap-4 border-b border-surface-container-highest/50 pb-8 pt-2 md:grid-cols-2">
              {data.keyReport.slice(0, 4).map((entry) => {
                const accuracyPct =
                  entry.totalPresses > 0
                    ? ((entry.totalPresses - entry.incorrectPresses) / entry.totalPresses) * 100
                    : 100;
                const slow = entry.avgLatencyMs > 180;
                return (
                  <div
                    key={`${entry.key}-${entry.shiftRequired ? "s" : "b"}`}
                    className="flex items-center justify-between rounded-xl border border-surface-container-highest/50 bg-surface-container-low p-4"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-lg border font-code-sm font-bold text-code-sm",
                          entry.incorrectPresses > 0
                            ? "border-error/30 bg-error-container/20 text-error"
                            : slow
                              ? "border-primary-container/30 bg-primary-container/10 text-primary"
                              : "border-secondary/30 bg-secondary-container/10 text-secondary",
                        )}
                      >
                        {entry.key}
                      </div>
                      <div>
                        <span className="block font-code-sm text-code-sm font-semibold text-on-surface">
                          {KEY_LABELS[entry.key] ?? "Character"} (`{entry.key}`)
                        </span>
                        <span className="font-code-sm text-[11px] text-on-surface-variant">
                          {entry.incorrectPresses > 0
                            ? `${entry.incorrectPresses} miss${entry.incorrectPresses > 1 ? "es" : ""} of ${entry.totalPresses}`
                            : "clean hits"}{" "}
                          • {Math.round(entry.avgLatencyMs)}ms avg
                        </span>
                      </div>
                    </div>
                    <div className="text-right font-code-sm">
                      <span
                        className={cn(
                          "block text-code-sm font-bold",
                          accuracyPct === 100 ? "text-secondary" : "text-error",
                        )}
                      >
                        {fmt1(accuracyPct)}%
                      </span>
                      <span className="block font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
                        {accuracyPct === 100 ? "Final Clean Hit" : "Key Accuracy"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Attempt history strip (comparison with previous attempts) */}
          {history.length > 1 && (
            <div className="border-b border-surface-container-highest/50 py-6">
              <span className="mb-3 block font-code-sm text-code-sm uppercase tracking-wider text-on-surface-variant">
                Attempt History (last {history.length})
              </span>
              <div className="flex flex-wrap gap-space-sm">
                {[...history].reverse().map((attempt) => {
                  const attemptPassed = evaluateAttempt({
                    completed: attempt.completed,
                    accuracy: attempt.accuracy,
                    wpm: attempt.wpm,
                  });
                  return (
                    <div
                      key={attempt.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border px-3 py-2 font-code-sm text-code-sm",
                        attempt.id === (dbAttempt?.id ?? -1)
                          ? "border-primary-container/50 bg-primary-container/10 text-primary"
                          : "border-surface-container-highest/50 bg-surface-container-low text-on-surface-variant",
                      )}
                    >
                      <span className="font-bold">#{attempt.attemptNumber}</span>
                      <span>{fmt1(attempt.wpm)} WPM</span>
                      <span>{fmt1(attempt.accuracy)}%</span>
                      <span
                        className={cn(
                          "font-semibold",
                          attemptPassed === "PASS" ? "text-secondary" : "text-error",
                        )}
                      >
                        {attemptPassed}
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
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-surface-container-highest/60 bg-surface-container px-4 py-2.5 font-code-sm text-code-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface sm:w-auto"
              >
                <span className="material-symbols-outlined text-[14px]">arrow_back</span>
                <span>All Lessons [Esc]</span>
              </button>
              <button
                type="button"
                onClick={retryLesson}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-surface-container-highest/60 bg-surface-container px-4 py-2.5 font-code-sm text-code-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface sm:w-auto"
              >
                <span className="material-symbols-outlined text-[14px]">refresh</span>
                <span>Retry Lesson [^R]</span>
              </button>
            </div>

            {passed && nextLessonInfo && (
              <button
                type="button"
                onClick={nextLesson}
                className="flex w-full items-center justify-center gap-3 rounded-xl bg-primary-container px-7 py-3 font-label-md text-sm font-semibold text-on-primary-container shadow-lg shadow-primary-container/25 transition-all hover:bg-tertiary-container sm:w-auto"
              >
                <span>
                  Next Lesson: Module {nextLessonInfo.level}.
                  {String(nextLessonInfo.orderIndex + 1).padStart(2, "0")}
                </span>
                <kbd className="rounded border border-on-primary-container/40 bg-on-primary-container/20 px-2 py-0.5 font-code-sm text-[11px] text-on-primary-container">
                  Enter ↵
                </kbd>
              </button>
            )}
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
                ? "Local SQLite ledger synced"
                : `NOT SAVED: ${persistError}`}
            </span>
            {persistError !== null && (
              <button
                type="button"
                onClick={() => void useSessionStore.getState().retryPersist()}
                className="rounded bg-surface-container px-2 py-0.5 font-bold text-on-surface hover:bg-surface-container-high"
              >
                RETRY SAVE
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>
              Streak: <strong className="font-bold text-primary">12 Days</strong>
            </span>
            <span className="text-outline-variant">•</span>
            <span>
              Daily Target: <strong className="text-on-surface">— / — min</strong>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
