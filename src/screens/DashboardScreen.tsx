import { ScreenStub } from "../components/ScreenStub";

/**
 * Stub — Dashboard (operator status overview: progress hero, current lesson,
 * recent attempts, streak, weak keys).
 * Design: `screens/dashboard_typekernel/` — implemented in Phase 5.
 */
export default function DashboardScreen() {
  return (
    <ScreenStub
      screenId="dashboard"
      phase={5}
      description="Operator status overview: progress hero, current-lesson card, recent attempts, streak and weak keys radar."
    />
  );
}
