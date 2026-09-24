import { evaluateAttempt } from "../lib/curriculum/rules";
import { StatusPill } from "./StatusPill";

/**
 * AttemptResultPill — Passed/Failed pill for attempt history tables
 * (plan §7.2). Single source of truth for the pass-gate rendering shared by
 * the Dashboard and Statistics recent-attempts tables.
 */
export function AttemptResultPill({
  completed,
  wpm,
  accuracy,
}: {
  completed: boolean;
  wpm: number;
  accuracy: number;
}) {
  const passed = evaluateAttempt({ completed, accuracy, wpm }) === "PASS";
  return (
    <StatusPill tone={passed ? "mastered" : "danger"}>
      {passed ? "Passed" : "Failed"}
    </StatusPill>
  );
}
