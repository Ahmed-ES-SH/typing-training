import { create } from "zustand";

import { attemptsRepo, bigramStatsRepo, keyStatsRepo, lessonsRepo, sessionsRepo } from "../lib/db/repositories";
import { buildKeyReport, completeAttempt, type AttemptOutcome } from "../lib/curriculum/progressService";
import { localDayKey } from "../lib/stats/dailyService";
import { applyEvent, createSession, isFinished } from "../lib/engine/engine";
import { liveMetrics } from "../lib/engine/metrics";
import type { InputEvent, SessionState } from "../lib/engine/types";
import {
  SessionSummarySchema,
  type Lesson,
  type SessionSummary,
} from "../lib/schemas";
import {
  focusKeyStatsOf,
  type DrillPlan,
  type FocusKeyStats,
} from "../lib/intelligence/drillService";
import { useUiStore } from "./useUiStore";
import { notifyStatsChanged } from "./useStatsStore";

/**
 * Session store (PRD §22) — TRANSIENT state only: current lesson, engine
 * state, timer tick, live metric inputs. Persistent history goes to SQLite
 * through the progress service at finish time; nothing historical lives here.
 *
 * Timer: one 200 ms interval updates `now` while a session runs, so live
 * metrics recompute on a tick instead of on every keystroke (no per-keystroke
 * re-render of the whole tree).
 *
 * Keydown routing lives in the screen's effect: printable chars, Backspace
 * and Enter are forwarded here; Ctrl/Alt/Meta combos pass through; Tab is
 * consumed as a space (code lines never contain tabs — tabs are rejected by
 * LessonSchema).
 */

export type SessionPhase = "idle" | "running" | "set-summary" | "finished";

/** How far the finish-persistence pipeline got (enables exact, safe retry). */
type PersistStage = "none" | "attempt-saved" | "keys-saved" | "done";

/** Result of one finished drill set (Weakness screen set summary). */
export interface DrillSetResult {
  wpm: number;
  accuracy: number;
  errorCount: number;
  durationMs: number;
  /** correct + incorrect chars committed in the set (chars_typed rollup). */
  chars: number;
  focus: FocusKeyStats;
}

/** Live drill runtime (plan §3.4: session store drill mode). */
export interface DrillRuntime {
  plan: DrillPlan;
  setIndex: number;
  setResults: DrillSetResult[];
}

const TICK_MS = 200;

interface SessionStore {
  phase: SessionPhase;
  lesson: Lesson | null;
  engineState: SessionState | null;
  /** Wall clock updated by the tick interval; drives live metric selectors. */
  now: number;
  summary: SessionSummary | null;
  /** Full §26 outcome of the finished attempt (verdict/grade/next lesson). */
  outcome: AttemptOutcome | null;
  persistError: string | null;
  persistStage: PersistStage;
  trainingSessionId: string | null;
  /** Wall-clock time the training_sessions row was opened (abandon path). */
  sessionStartedAt: number | null;
  /** Non-null while a weakness drill runs (plan §3.4). */
  drill: DrillRuntime | null;

  startLesson: (lesson: Lesson) => Promise<void>;
  /** Starts (or restarts from set 0) a weakness drill plan. */
  startDrill: (plan: DrillPlan) => Promise<void>;
  /** Continues to the next drill set after a set summary (Weakness screen). */
  resumeDrill: () => void;
  typeChar: (char: string) => void;
  backspace: () => void;
  /** Runs (or resumes) the save-attempt pipeline after a failure. */
  retryPersist: () => Promise<void>;
  /**
   * §3.7 abandon path: leaving an ACTIVE session via navigation closes the
   * `training_sessions` row (ended_at set, chars typed so far kept) but
   * writes NO attempt row — partial typing is not an attempt (§10 applies
   * to finished attempts). Counters stay unpolluted.
   */
  abandon: () => Promise<void>;
  reset: () => void;
}

let timerId: ReturnType<typeof setInterval> | null = null;

function stopTimer(): void {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer(onTick: () => void): void {
  stopTimer();
  timerId = setInterval(onTick, TICK_MS);
}

export const useSessionStore = create<SessionStore>((set, get) => {
  /** The §26 save-attempt pipeline: insert attempt + best-stats + unlock
   * decision (progressService), then key statistics, then close the training
   * session. Stage-tracked, so a retry never double-inserts an attempt;
   * failures surface in `persistError` and the Results screen still renders
   * from the in-memory summary with a NOT SAVED marker. */
  const persistFinishedSession = async (): Promise<void> => {
    const { engineState, lesson, trainingSessionId, drill } = get();
    if (engineState === null || lesson === null) return;

    if (engineState.startedAt === null || engineState.finishedAt === null) {
      // Nothing was typed — nothing to persist; just show the finished UI.
      stopTimer();
      set({ phase: "finished", persistStage: "done", persistError: null });
      return;
    }

    stopTimer();
    set({ phase: "finished" });

    const metrics = liveMetrics(engineState, engineState.finishedAt);
    const attemptMetrics = {
      wpm: metrics.wpm,
      accuracy: metrics.accuracy,
      errorRate: metrics.errorRate,
      errorCount: metrics.incorrectChars,
      correctChars: metrics.correctChars,
      incorrectChars: metrics.incorrectChars,
      backspaceCount: metrics.backspaceCount,
      durationMs: metrics.elapsedMs,
      startedAt: engineState.startedAt,
      finishedAt: engineState.finishedAt,
    };
    // Per-attempt key spotlight (§ Results screen key cards): worst chars.
    const keyReport = buildKeyReport(
      engineState.keyEvents.map((k) => ({
        key: k.expected,
        shiftRequired: k.shiftRequired,
        totalPresses: 1,
        incorrectPresses: k.correct ? 0 : 1,
        avgLatencyMs: k.latencyMs,
      })),
    );

    // Rollup events shared by both persistence paths (lifetime + daily +
    // bigrams — the §21.1 pipeline feeding heatmap/analyzer/drills).
    const events = engineState.keyEvents.map((k) => ({
      key: k.expected,
      shiftRequired: k.shiftRequired,
      correct: k.correct,
      latencyMs: k.latencyMs,
    }));

    /* ---------------------- drill persistence branch ----------------- */
    /* kind='weakness' attempts (lesson_id NULL), key rollups, then set
     * advance. Drill metrics NEVER touch lesson_progress (plan §2) and no
     * navigation happens — the Weakness screen owns the flow. */
    if (drill !== null) {
      try {
        if (get().persistStage === "none") {
          await attemptsRepo.insertDrillAttempt(
            { kind: "weakness", ...attemptMetrics, completed: true },
            keyReport,
          );
          set({ persistStage: "attempt-saved", persistError: null });
        }

        if (get().persistStage === "attempt-saved") {
          await keyStatsRepo.recordBatch(events, Date.now());
          await keyStatsRepo.recordDaily(events, localDayKey(Date.now()));
          await bigramStatsRepo.recordBatch(events);
          set({ persistStage: "keys-saved", persistError: null });
        }

        if (get().persistStage === "keys-saved") {
          const focus = focusKeyStatsOf(engineState.keyEvents, drill.plan.focusKeys);
          const setResults = [
            ...drill.setResults,
            {
              wpm: attemptMetrics.wpm,
              accuracy: attemptMetrics.accuracy,
              errorCount: attemptMetrics.errorCount,
              durationMs: attemptMetrics.durationMs,
              chars: engineState.correctChars + engineState.incorrectChars,
              focus,
            },
          ];
          const nextIndex = drill.setIndex + 1;
          if (nextIndex < drill.plan.sets.length) {
            // Pause at the set summary: the Weakness screen shows per-set
            // stats and calls resumeDrill() for the next set ("content
            // reshapes after every set" — the plan pre-built them).
            const nextLesson = drill.plan.sets[nextIndex];
            stopTimer();
            set({
              drill: { plan: drill.plan, setIndex: nextIndex, setResults },
              lesson: nextLesson,
              engineState: createSession(nextLesson.content),
              phase: "set-summary",
              persistStage: "none",
              summary: null,
              outcome: null,
              persistError: null,
              now: Date.now(),
            });
          } else {
            // Final set done: close the training session, show the summary.
            if (trainingSessionId !== null) {
              await sessionsRepo.close(
                trainingSessionId,
                engineState.finishedAt,
                setResults.reduce((sum, r) => sum + r.durationMs, 0),
                setResults.reduce((sum, r) => sum + r.chars, 0),
              );
            }
            set({
              drill: { plan: drill.plan, setIndex: drill.setIndex, setResults },
              persistStage: "done",
              persistError: null,
            });
          }
        }
        notifyStatsChanged();
      } catch (error) {
        set({
          persistError:
            error instanceof Error ? error.message : "Failed to save drill set",
        });
      }
      return;
    }

    /* --------------------- lesson persistence branch ------------------ */
    try {
      if (get().persistStage === "none") {
        const outcome = await completeAttempt(lesson, attemptMetrics, keyReport);
        const summary = SessionSummarySchema.parse({
          lessonId: lesson.id,
          attemptNumber: outcome.attempt.attemptNumber,
          ...attemptMetrics,
          completed: true,
        });
        set({
          summary,
          outcome,
          persistStage: "attempt-saved",
          persistError: null,
        });
      }

      if (get().persistStage === "attempt-saved") {
        await keyStatsRepo.recordBatch(events, Date.now());
        // Phase 6 rollups: today's per-key daily row + planned bigrams —
        // the feed for the heatmap, weakness queue and recovery curves.
        await keyStatsRepo.recordDaily(events, localDayKey(Date.now()));
        await bigramStatsRepo.recordBatch(events);
        set({ persistStage: "keys-saved", persistError: null });
      }

      if (get().persistStage === "keys-saved") {
        if (trainingSessionId !== null) {
          await sessionsRepo.close(
            trainingSessionId,
            engineState.finishedAt,
            engineState.finishedAt - engineState.startedAt,
            engineState.correctChars + engineState.incorrectChars,
          );
        }
        set({ persistStage: "done", persistError: null });
      }

      // §26: finish -> results. attemptId is null when only the in-memory
      // summary exists (persistence failed) — the Results screen handles it.
      useUiStore.getState().navigate("lesson-results", {
        "lesson-results": { attemptId: get().outcome?.attempt.id ?? null },
      });
      // Charts/hero aggregates re-query on the next visit (cache drop).
      notifyStatsChanged();
    } catch (error) {
      // Attempts are never silently dropped: surface the error on the
      // Results screen (the summary itself is still shown from memory).
      set({
        persistError:
          error instanceof Error ? error.message : "Failed to save attempt",
      });
      useUiStore.getState().navigate("lesson-results", {
        "lesson-results": { attemptId: null },
      });
    }
  };

  /** Applies one keystroke to the engine state; auto-finishes at the end. */
  const apply = (event: InputEvent): void => {
    const { phase, engineState } = get();
    if (phase !== "running" || engineState === null) return;

    const next = applyEvent(engineState, event, Date.now());
    set({ engineState: next });

    if (isFinished(next)) void persistFinishedSession();
  };

  return {
    phase: "idle",
    lesson: null,
    engineState: null,
    now: Date.now(),
    summary: null,
    outcome: null,
    persistError: null,
    persistStage: "none",
    trainingSessionId: null,
    sessionStartedAt: null,
    drill: null,

    startDrill: async (plan) => {
      // A new drill abandons whatever session runs (§3.7 semantics).
      await get().abandon();
      stopTimer();
      const firstSet = plan.sets[0];
      if (!firstSet) return;
      set({
        phase: "running",
        lesson: firstSet,
        engineState: createSession(firstSet.content),
        now: Date.now(),
        summary: null,
        outcome: null,
        persistError: null,
        persistStage: "none",
        trainingSessionId: null,
        sessionStartedAt: Date.now(),
        drill: { plan, setIndex: 0, setResults: [] },
      });
      startTimer(() => set({ now: Date.now() }));

      try {
        // Drills have no lesson row: training_sessions.kind='weakness'
        // with lesson_id NULL. No lessonsRepo.upsert, no lesson_progress.
        const trainingSessionId = crypto.randomUUID();
        await sessionsRepo.open({
          id: trainingSessionId,
          kind: "weakness",
          lessonId: null,
          startedAt: Date.now(),
          endedAt: null,
          durationMs: null,
          charsTyped: 0,
        });
        set({ trainingSessionId, persistError: null });
      } catch (error) {
        set({
          persistError:
            error instanceof Error ? error.message : "Failed to open drill session",
        });
      }
    },

    resumeDrill: () => {
      if (get().phase !== "set-summary" || get().drill === null) return;
      set({ phase: "running", now: Date.now() });
      startTimer(() => set({ now: Date.now() }));
    },

    startLesson: async (lesson) => {
      // Navigating into a new session while one is running abandons the old
      // one first (§3.7): its session row closes, no attempt row is written.
      await get().abandon();
      stopTimer();
      set({
        phase: "running",
        lesson,
        engineState: createSession(lesson.content),
        now: Date.now(),
        summary: null,
        outcome: null,
        persistError: null,
        persistStage: "none",
        trainingSessionId: null,
        sessionStartedAt: Date.now(),
        drill: null,
      });
      startTimer(() => set({ now: Date.now() }));

      try {
        // The curriculum seed normally covers this; the upsert is a cheap
        // safety net so FK targets always exist.
        await lessonsRepo.upsert(lesson);
        const trainingSessionId = crypto.randomUUID();
        await sessionsRepo.open({
          id: trainingSessionId,
          kind: "lesson",
          lessonId: lesson.id,
          startedAt: Date.now(),
          endedAt: null,
          durationMs: null,
          charsTyped: 0,
        });
        set({ trainingSessionId, persistError: null });
      } catch (error) {
        set({
          persistError:
            error instanceof Error ? error.message : "Failed to open session",
        });
      }
    },

    typeChar: (char) => apply({ type: "char", char }),
    backspace: () => apply({ type: "backspace" }),
    retryPersist: persistFinishedSession,

    abandon: async () => {
      const { phase, trainingSessionId, sessionStartedAt, engineState } = get();
      if (phase !== "running") return;
      stopTimer();

      if (trainingSessionId !== null) {
        const now = Date.now();
        const startedAt = sessionStartedAt ?? now;
        const charsTyped =
          engineState !== null
            ? engineState.correctChars + engineState.incorrectChars
            : 0;
        try {
          // Close the session row (ended_at set = abandoned, since no attempt
          // row will ever reference it). Best effort: never block navigation.
          await sessionsRepo.close(trainingSessionId, now, now - startedAt, charsTyped);
        } catch {
          // A force-quit may leave an unclosed row — tolerated per schema note.
        }
      }

      set({
        phase: "idle",
        lesson: null,
        engineState: null,
        summary: null,
        outcome: null,
        persistStage: "none",
        trainingSessionId: null,
        sessionStartedAt: null,
        drill: null,
      });
      notifyStatsChanged();
    },

    reset: () => {
      stopTimer();
      set({
        phase: "idle",
        lesson: null,
        engineState: null,
        summary: null,
        outcome: null,
        persistError: null,
        persistStage: "none",
        trainingSessionId: null,
        sessionStartedAt: null,
        drill: null,
      });
    },
  };
});
