import { create } from "zustand";

import {
  attemptsRepo,
  keyStatsRepo,
  lessonsRepo,
  sessionsRepo,
} from "../lib/db/repositories";
import { applyEvent, createSession, isFinished } from "../lib/engine/engine";
import { liveMetrics } from "../lib/engine/metrics";
import type { InputEvent, SessionState } from "../lib/engine/types";
import {
  SessionSummarySchema,
  type Lesson,
  type SessionSummary,
} from "../lib/schemas";

/**
 * Session store (PRD §22) — TRANSIENT state only: current lesson, engine
 * state, timer tick, live metric inputs. Persistent history goes to SQLite
 * through the repositories at finish time; nothing historical lives here.
 *
 * Timer: one 200 ms interval updates `now` while a session runs, so live
 * metrics recompute on a tick instead of on every keystroke (no per-keystroke
 * re-render of the whole tree).
 *
 * Keydown routing lives in the screen's effect (plan §3.7): printable chars,
 * Backspace and Enter are forwarded here; Ctrl/Alt/Meta combos pass through;
 * Tab is consumed as a space (code lines never contain tabs — tabs are
 * rejected by LessonSchema).
 */

export type SessionPhase = "idle" | "running" | "finished";

/** How far the finish-persistence pipeline got (enables exact, safe retry). */
type PersistStage = "none" | "attempt-saved" | "keys-saved" | "done";

const TICK_MS = 200;

interface SessionStore {
  phase: SessionPhase;
  lesson: Lesson | null;
  engineState: SessionState | null;
  /** Wall clock updated by the tick interval; drives live metric selectors. */
  now: number;
  summary: SessionSummary | null;
  persistError: string | null;
  persistStage: PersistStage;
  trainingSessionId: string | null;

  startLesson: (lesson: Lesson) => Promise<void>;
  typeChar: (char: string) => void;
  backspace: () => void;
  /** Runs (or resumes) the save-attempt pipeline after a failure. */
  retryPersist: () => Promise<void>;
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
  /** The §26 save-attempt pipeline. Stage-tracked, so a retry never
   * double-inserts an attempt; failures surface in `persistError`. */
  const persistFinishedSession = async (): Promise<void> => {
    const { engineState, lesson, trainingSessionId } = get();
    if (engineState === null || lesson === null) return;

    if (engineState.startedAt === null || engineState.finishedAt === null) {
      // Nothing was typed — nothing to persist; just show the finished UI.
      stopTimer();
      set({ phase: "finished", persistStage: "done", persistError: null });
      return;
    }

    stopTimer();
    set({ phase: "finished" });

    try {
      if (get().persistStage === "none") {
        const metrics = liveMetrics(engineState, engineState.finishedAt);
        const summary = SessionSummarySchema.parse({
          lessonId: lesson.id,
          attemptNumber: await attemptsRepo.nextAttemptNumber(lesson.id),
          wpm: metrics.wpm,
          accuracy: metrics.accuracy,
          errorRate: metrics.errorRate,
          errorCount: metrics.incorrectChars,
          correctChars: metrics.correctChars,
          incorrectChars: metrics.incorrectChars,
          backspaceCount: metrics.backspaceCount,
          durationMs: metrics.elapsedMs,
          completed: true,
          startedAt: engineState.startedAt,
          finishedAt: engineState.finishedAt,
        });
        set({ summary });
        await attemptsRepo.insert(summary);
        set({ persistStage: "attempt-saved", persistError: null });
      }

      if (get().persistStage === "attempt-saved") {
        const events = engineState.keyEvents.map((k) => ({
          key: k.expected,
          shiftRequired: k.shiftRequired,
          correct: k.correct,
          latencyMs: k.latencyMs,
        }));
        await keyStatsRepo.recordBatch(events, Date.now());
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
    } catch (error) {
      // Attempts are never silently dropped (plan §3.7): surface the error.
      set({
        persistError:
          error instanceof Error ? error.message : "Failed to save attempt",
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
    persistError: null,
    persistStage: "none",
    trainingSessionId: null,

    startLesson: async (lesson) => {
      stopTimer();
      set({
        phase: "running",
        lesson,
        engineState: createSession(lesson.content),
        now: Date.now(),
        summary: null,
        persistError: null,
        persistStage: "none",
        trainingSessionId: null,
      });
      startTimer(() => set({ now: Date.now() }));

      try {
        // Fixture lessons are synced so FK targets exist (Phase 4 seeds all).
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

    reset: () => {
      stopTimer();
      set({
        phase: "idle",
        lesson: null,
        engineState: null,
        summary: null,
        persistError: null,
        persistStage: "none",
        trainingSessionId: null,
      });
    },
  };
});
