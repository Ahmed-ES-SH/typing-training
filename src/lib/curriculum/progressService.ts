import { nextLessonInOrder } from "../../content";
import type { Lesson } from "../schemas";
import type { KeyReportEntry } from "../schemas";
import { attemptsRepo, progressRepo } from "../db/repositories";
import type { AttemptRow } from "../schemas";
import { evaluateAttempt, gradeFor, type AttemptVerdict, type Grade } from "./rules";

/**
 * Progress service (PRD §10, §11, §26; Phase 4 plan §3.5).
 *
 * `completeAttempt` is the §26 finish pipeline: append the attempt
 * (transactional MAX+1 numbering), merge best-statistics, apply the §8
 * unlock rule, unlock the next lesson in curriculum order — and never
 * downgrade any status (re-lock prevention lives in the conditional UPDATE).
 */

export interface AttemptMetrics {
  wpm: number;
  accuracy: number;
  errorRate: number;
  errorCount: number;
  correctChars: number;
  incorrectChars: number;
  backspaceCount: number;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
}

export interface AttemptOutcome {
  attempt: AttemptRow;
  verdict: AttemptVerdict;
  grade: Grade;
  /** Next lesson in curriculum order when the attempt passed (else null). */
  nextLessonId: string | null;
}

/**
 * Aggregates raw keystroke events into the attempt's key spotlight rows:
 * worst chars first (most incorrect, then slowest average latency).
 */
export function buildKeyReport(
  events: KeyReportEntry[],
  limit = 4,
): KeyReportEntry[] {
  const groups = new Map<
    string,
    {
      key: string;
      shiftRequired: boolean;
      totalPresses: number;
      incorrectPresses: number;
      latencySumMs: number;
    }
  >();
  for (const event of events) {
    const id = `${event.key}\u0000${event.shiftRequired ? "1" : "0"}`;
    const group = groups.get(id);
    if (group) {
      group.totalPresses += event.totalPresses;
      group.incorrectPresses += event.incorrectPresses;
      group.latencySumMs += event.avgLatencyMs * event.totalPresses;
    } else {
      groups.set(id, {
        key: event.key,
        shiftRequired: event.shiftRequired,
        totalPresses: event.totalPresses,
        incorrectPresses: event.incorrectPresses,
        latencySumMs: event.avgLatencyMs * event.totalPresses,
      });
    }
  }
  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      shiftRequired: g.shiftRequired,
      totalPresses: g.totalPresses,
      incorrectPresses: g.incorrectPresses,
      avgLatencyMs: g.latencySumMs / g.totalPresses,
    }))
    .sort((a, b) =>
      (b.incorrectPresses - a.incorrectPresses) ||
      (b.avgLatencyMs - a.avgLatencyMs),
    )
    .slice(0, limit);
}

/**
 * Runs the §26 finish pipeline for one finished attempt and returns the
 * outcome for the Results screen.
 */
export async function completeAttempt(
  lesson: Lesson,
  metrics: AttemptMetrics,
  keyReport: KeyReportEntry[],
  now = Date.now(),
): Promise<AttemptOutcome> {
  // 1. Append the attempt; numbering is MAX+1 inside the INSERT itself.
  const attempt = await attemptsRepo.insertWithNextNumber(
    {
      lessonId: lesson.id,
      wpm: metrics.wpm,
      accuracy: metrics.accuracy,
      errorRate: metrics.errorRate,
      errorCount: metrics.errorCount,
      correctChars: metrics.correctChars,
      incorrectChars: metrics.incorrectChars,
      backspaceCount: metrics.backspaceCount,
      durationMs: metrics.durationMs,
      completed: true,
      startedAt: metrics.startedAt,
      finishedAt: metrics.finishedAt,
    },
    keyReport,
  );

  // 2. §11 best-statistics merge (bests move forward only, count + 1).
  const attemptInput = {
    completed: true,
    accuracy: attempt.accuracy,
    wpm: attempt.wpm,
  };
  await progressRepo.mergeAttemptStats(
    {
      lessonId: lesson.id,
      status: "available",
      bestWpm: attempt.wpm,
      bestAccuracy: attempt.accuracy,
      lowestErrorRate: attempt.errorRate,
      attemptCount: 1,
      unlockedAt: now,
      completedAt: null,
      updatedAt: now,
    },
    now,
  );

  // 3. §8 unlock rule: PASS marks this lesson completed (never touching its
  // original unlocked_at) and unlocks the next lesson IF it is still locked.
  const verdict = evaluateAttempt(attemptInput);
  let nextLessonId: string | null = null;

  if (verdict === "PASS") {
    const current = await progressRepo.get(lesson.id);
    const next = nextLessonInOrder(lesson.id);
    // First completion stamps completed_at; replays keep the original date.
    const firstCompletion = current?.status !== "completed";
    await progressRepo.upsert({
      lessonId: lesson.id,
      status: "completed",
      bestWpm: current?.bestWpm ?? attempt.wpm,
      bestAccuracy: current?.bestAccuracy ?? attempt.accuracy,
      lowestErrorRate: current?.lowestErrorRate ?? attempt.errorRate,
      attemptCount: current?.attemptCount ?? 1,
      unlockedAt: current?.unlockedAt ?? now,
      completedAt: firstCompletion ? now : (current?.completedAt ?? now),
      updatedAt: now,
    });
    if (next) {
      await progressRepo.unlockIfLocked(next.id, now);
      nextLessonId = next.id;
    }
  }

  return { attempt, verdict, grade: gradeFor(attemptInput), nextLessonId };
}
