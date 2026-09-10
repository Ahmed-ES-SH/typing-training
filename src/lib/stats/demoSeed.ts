import { CURRICULUM_LESSONS, nextLessonInOrder } from "../../content";
import {
  attemptsRepo,
  bigramStatsRepo,
  keyStatsRepo,
  lessonsRepo,
  progressRepo,
  sessionsRepo,
} from "../db/repositories";
import { seedCurriculum } from "../curriculum/seed";
import { getStreak, localDayKey } from "./dailyService";

/**
 * DEV-ONLY demo-data seeder (Phase 5 plan §3.6).
 *
 * Generates ~600 realistic completed attempts across the first 80 lessons
 * and ~90 days (WPM/accuracy drift upward, `{` and `:` seeded as weak keys)
 * so charts, streaks, radar and pagination can be verified without typing
 * 600 sessions by hand.
 *
 * Everything goes through the REAL repositories (no SQL shortcuts), so
 * seeded data reconciles exactly like organically typed data. Imported
 * dynamically from the dev-only dashboard button — never shipped.
 */

/** Deterministic PRNG (mulberry32) — reproducible demo history. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Shift requirement heuristic for the key-statistics events. */
function requiresShift(char: string): boolean {
  return /[A-Z~!@#$%^&*()_+{}|:"<>?]/.test(char);
}

/** Expected demo scale — the generator walks ~600 attempts. */
const DEMO_LESSONS = 80;
const DEMO_WINDOW_DAYS = 90;

export async function seedDemoHistory(now = Date.now()): Promise<{ attempts: number }> {
  // Curriculum rows first (idempotent) — attempts FK onto lessons.
  await seedCurriculum(now);

  // Idempotence for repeated dev clicks: never seed twice.
  if ((await attemptsRepo.countAll()) > 0) return { attempts: 0 };

  const rand = mulberry32(0x7e5711);
  const lessons = CURRICULUM_LESSONS.slice(0, DEMO_LESSONS);
  const windowMs = DEMO_WINDOW_DAYS * 86_400_000;

  // Rough attempt total for slotting; exact counts are random per lesson.
  const counts = lessons.map(() => 4 + Math.floor(rand() * 7));
  const totalAttempts = counts.reduce((sum, count) => sum + count, 0);

  let attemptIndex = 0;
  let lastPassedLessonId: string | null = null;

  for (let li = 0; li < lessons.length; li++) {
    const lesson = lessons[li];
    await lessonsRepo.upsert(lesson);
    const sample = Array.from(lesson.content.replace(/\n/g, " ").slice(0, 48));

    for (let a = 0; a < counts[li]; a++) {
      attemptIndex += 1;
      const isFinal = a === counts[li] - 1;
      // Global skill curve: 0 -> 1 over the whole window, plus within-lesson
      // progress and noise.
      const skill = attemptIndex / totalAttempts;
      const passFinal = isFinal && rand() < 0.92;

      const wpm = clamp(
        26 + skill * 32 + ((a + 1) / counts[li]) * 6 + rand() * 6 - 3,
        18,
        95,
      );
      const accuracy = passFinal
        ? clamp(95.6 + rand() * 3, 95.1, 100)
        : clamp(88 + skill * 8 + ((a + 1) / counts[li]) * 4 + rand() * 5 - 2.5, 70, 99.4);

      // Slot the attempt across the 90-day window; jitter clusters attempts
      // into some days and leaves others empty (natural-looking streaks).
      const slot = (attemptIndex / (totalAttempts + 3)) * windowMs;
      const durationMs = Math.round(45_000 + rand() * 105_000);
      const startedAt = Math.min(
        now - durationMs - 1_000,
        now - windowMs + Math.round(slot + rand() * 9_000_000),
      );
      const finishedAt = startedAt + durationMs;
      const charsTyped = Math.round(90 + rand() * 120);

      // 1. Append the attempt through the real ledger path.
      await attemptsRepo.insertWithNextNumber({
        lessonId: lesson.id,
        wpm,
        accuracy,
        errorRate: clamp(100 - accuracy, 0, 100),
        errorCount: Math.round((100 - accuracy) / 2),
        correctChars: charsTyped,
        incorrectChars: Math.round(charsTyped * ((100 - accuracy) / 300)),
        backspaceCount: Math.round(2 + rand() * 8),
        durationMs,
        completed: true,
        startedAt,
        finishedAt,
      });

      // 2. Best-statistics merge (§11) — identical to live finishing.
      await progressRepo.mergeAttemptStats(
        {
          lessonId: lesson.id,
          status: "available",
          bestWpm: wpm,
          bestAccuracy: accuracy,
          lowestErrorRate: clamp(100 - accuracy, 0, 100),
          attemptCount: 1,
          unlockedAt: startedAt,
          completedAt: null,
          updatedAt: finishedAt,
        },
        finishedAt,
      );

      // 3. Gate passes mark the lesson completed and unlock the next one.
      if (accuracy >= 92 && wpm > 45) {
        const current = await progressRepo.get(lesson.id);
        await progressRepo.upsert({
          lessonId: lesson.id,
          status: "completed",
          bestWpm: current?.bestWpm ?? wpm,
          bestAccuracy: current?.bestAccuracy ?? accuracy,
          lowestErrorRate: current?.lowestErrorRate ?? clamp(100 - accuracy, 0, 100),
          attemptCount: current?.attemptCount ?? 1,
          unlockedAt: current?.unlockedAt ?? startedAt,
          completedAt: current?.completedAt ?? finishedAt,
          updatedAt: finishedAt,
        });
        const next = nextLessonInOrder(lesson.id);
        if (next) await progressRepo.unlockIfLocked(next.id, finishedAt);
        lastPassedLessonId = lesson.id;
      }

      // 4. Key statistics: weak `{`/`:`, improving accuracy elsewhere. The
      // same events feed lifetime, daily (Phase 6) and bigram rollups so
      // heatmap/queue/recovery curves reconcile with organic typing.
      const events = sample.map((char) => {
        let missRate: number;
        if (char === "{") missRate = 0.24 - skill * 0.06;
        else if (char === ":") missRate = 0.2 - skill * 0.05;
        else if (!/[a-z ]/.test(char)) missRate = 0.1 - skill * 0.05;
        else missRate = 0.05 - skill * 0.035;
        const correct = rand() > Math.max(0.01, missRate);
        return {
          key: char === " " ? " " : char,
          shiftRequired: requiresShift(char),
          correct,
          latencyMs: Math.round(95 + rand() * 160 - skill * 40),
        };
      });
      await keyStatsRepo.recordBatch(events, finishedAt);
      await keyStatsRepo.recordDaily(events, localDayKey(finishedAt));
      await bigramStatsRepo.recordBatch(events);

      // 5. Training session row (§21) — opened and closed like the real flow.
      const sessionId = `demo-${attemptIndex}`;
      await sessionsRepo.open({
        id: sessionId,
        kind: "lesson",
        lessonId: lesson.id,
        startedAt,
        endedAt: null,
        durationMs: null,
        charsTyped: 0,
      });
      await sessionsRepo.close(
        sessionId,
        finishedAt,
        durationMs,
        charsTyped + Math.round(charsTyped * ((100 - accuracy) / 300)),
      );
    }
  }

  // Leave the curriculum frontier right after the last demo lesson.
  const frontier = nextLessonInOrder(lastPassedLessonId ?? lessons[lessons.length - 1].id);
  if (frontier) await progressRepo.unlockIfLocked(frontier.id, now);

  // 6. A short weakness-drill history (Phase 6): kind='weakness' attempts
  // with lesson_id NULL, so the Weakness screen header shows a real drill
  // count and the unified ledger includes every attempt kind.
  for (let d = 0; d < 12; d++) {
    const durationMs = Math.round(90_000 + rand() * 40_000);
    const finishedAt = now - d * 43_200_000 - Math.round(rand() * 3_600_000);
    const startedAt = finishedAt - durationMs;
    const accuracy = clamp(84 + rand() * 10, 80, 96);
    await attemptsRepo.insertDrillAttempt({
      kind: "weakness",
      wpm: clamp(28 + rand() * 14, 22, 55),
      accuracy,
      errorRate: clamp(100 - accuracy, 0, 100),
      errorCount: Math.round((100 - accuracy) / 2),
      correctChars: 112,
      incorrectChars: Math.round(120 * ((100 - accuracy) / 300)),
      backspaceCount: Math.round(2 + rand() * 5),
      durationMs,
      completed: true,
      startedAt,
      finishedAt,
    });
  }

  // Persist the demo best streak (same path as live training).
  await getStreak(now);

  return { attempts: attemptIndex };
}
