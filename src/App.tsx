import { lazy, Suspense, useEffect } from "react";
import type { ComponentType } from "react";

import { Shell } from "./components/Shell";
import { TopBar } from "./components/TopBar";
import type { ScreenId } from "./lib/screens";
import { useCurriculumStore } from "./stores/useCurriculumStore";
import { useUiStore } from "./stores/useUiStore";
import CustomLessonsScreen from "./screens/CustomLessonsScreen";
import DashboardScreen from "./screens/DashboardScreen";
import LessonResultsScreen from "./screens/LessonResultsScreen";
import LessonsScreen from "./screens/LessonsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import TypingSessionScreen from "./screens/TypingSessionScreen";
import WeaknessTrainingScreen from "./screens/WeaknessTrainingScreen";

/** Statistics is lazy-loaded so recharts stays out of the startup chunk
 * (§25 / Phase 5 plan §2). */
const StatisticsScreen = lazy(() => import("./screens/StatisticsScreen"));

const SCREEN_COMPONENTS: Record<ScreenId, ComponentType> = {
  dashboard: DashboardScreen,
  lessons: LessonsScreen,
  "typing-session": TypingSessionScreen,
  "lesson-results": LessonResultsScreen,
  statistics: StatisticsScreen,
  "weakness-training": WeaknessTrainingScreen,
  "custom-lessons": CustomLessonsScreen,
  settings: SettingsScreen,
};

function App() {
  const activeScreen = useUiStore((state) => state.activeScreen);
  const bootstrap = useCurriculumStore((state) => state.bootstrap);
  const ActiveScreen = SCREEN_COMPONENTS[activeScreen];

  // Phase 4 startup: seed the 260-lesson curriculum and load progress rows
  // (idempotent; failures surface as a graceful in-app error state).
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <Shell>
      <TopBar />
      <Suspense
        fallback={
          <main className="flex w-full flex-1 items-center justify-center bg-surface">
            <span className="animate-pulse font-code-sm text-code-sm uppercase tracking-widest text-outline">
              Loading module…
            </span>
          </main>
        }
      >
        <ActiveScreen />
      </Suspense>
    </Shell>
  );
}

export default App;
