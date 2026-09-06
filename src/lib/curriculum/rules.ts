/**
 * Unlock rule & grading (PRD §8; Phase 4 plan §2, §3.5).
 *
 * The gate is verbatim from the PRD: an attempt passes only when the SAME
 * attempt has accuracy >= 95 AND WPM > 45 (exactly 45.0 fails) while the
 * buffer was fully completed. Unlock state itself is enforced at the data
 * layer (`progressRepo.unlockIfLocked`) — grades are presentational only
 * and never affect unlocking.
 */

export const ACCURACY_GATE = 95;
/** Strictly greater-than: 45.0 WPM does NOT pass. */
export const WPM_GATE = 45;

export type AttemptVerdict = "PASS" | "FAIL";
export type Grade = "S" | "A" | "B" | "C" | "D" | "F";

export interface AttemptGateInput {
  /** Whether the buffer was fully typed (incomplete attempts never pass). */
  completed: boolean;
  accuracy: number;
  wpm: number;
}

/** The §8 gate — both conditions in the same attempt. */
export function evaluateAttempt(input: AttemptGateInput): AttemptVerdict {
  return input.completed &&
    input.accuracy >= ACCURACY_GATE &&
    input.wpm > WPM_GATE
    ? "PASS"
    : "FAIL";
}

/**
 * §16 optional personal targets of a CUSTOM module — display-only (plan §2:
 * they color the Results threshold line and card badges, never a lock, and
 * they never touch the §8 curriculum gate). null target = that dimension is
 * not evaluated; both null = no personal verdict at all.
 */
export function evaluatePersonal(
  input: AttemptGateInput,
  wpmTarget: number | null,
  accuracyTarget: number | null,
): AttemptVerdict | null {
  if (wpmTarget === null && accuracyTarget === null) return null;
  const wpmOk = wpmTarget === null || input.wpm > wpmTarget;
  const accOk = accuracyTarget === null || input.accuracy >= accuracyTarget;
  return input.completed && wpmOk && accOk ? "PASS" : "FAIL";
}

/**
 * Presentational grade scale (Phase 4 plan §2). Grades never influence
 * unlocking — a C pass unlocks exactly like an S pass.
 */
export function gradeFor(input: AttemptGateInput): Grade {
  if (evaluateAttempt(input) === "PASS") {
    if (input.wpm >= 65 && input.accuracy >= 98) return "S";
    if (input.wpm >= 55 && input.accuracy >= 97) return "A";
    if (input.wpm >= 50) return "B";
    return "C";
  }
  return input.accuracy >= 90 ? "D" : "F";
}
