import { ScreenStub } from "../components/ScreenStub";

/**
 * Stub — Typing Session (module sidebar, code buffer with per-char
 * evaluation, live WPM/accuracy telemetry, terminal drawer).
 * Design: `screens/current_lesson_typekernel/` — implemented in Phase 3.
 */
export default function TypingSessionScreen() {
  return (
    <ScreenStub
      screenId="typing-session"
      phase={3}
      description="Live training session: module sidebar, code buffer with current-char highlight and real-time telemetry."
    />
  );
}
