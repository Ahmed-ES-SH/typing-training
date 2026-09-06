import { lazy, Suspense, useEffect } from "react";
import type { ComponentType } from "react";

import { Shell } from "./components/Shell";
import { TopBar } from "./components/TopBar";
import type { ScreenId } from "./lib/screens";
import { useCurriculumStore, currentLesson } from "./stores/useCurriculumStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useUiStore } from "./stores/useUiStore";
import CustomLessonsScreen from "./screens/CustomLessonsScreen";
import DashboardScreen from "./screens/DashboardScreen";
import LessonResultsScreen from "./screens/LessonResultsScreen";
import LessonsScreen from "./screens/LessonsScreen";
import SettingsScreen from "./screens/SettingsScreen";
import TypingSessionScreen from "./screens/TypingSessionScreen";

/** Statistics (recharts) and Weakness Training (recharts + adaptive
 * generator) are lazy-loaded so the startup chunk stays chart-free (§25). */
const StatisticsScreen = lazy(() => import("./screens/StatisticsScreen"));
const WeaknessTrainingScreen = lazy(
  () => import("./screens/WeaknessTrainingScreen"),
);

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
  const hydrateSettings = useSettingsStore((state) => state.hydrate);
  const ActiveScreen = SCREEN_COMPONENTS[activeScreen];

  // Phase 4 startup: seed the 260-lesson curriculum and load progress rows
  // (idempotent; failures surface as a graceful in-app error state).
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Phase 7: hydrate preferences from the settings table, then apply the
  // §20 launch behavior once the curriculum is loaded.
  useEffect(() => {
    void hydrateSettings().then(() => {
      const { settings } = useSettingsStore.getState();

      // Statistics default range (§20 statistics preference).
      if (settings.statsDefaultRange !== "30d") {
        void import("./stores/useStatsStore").then(({ useStatsStore }) => {
          useStatsStore.getState().setRange(settings.statsDefaultRange);
        });
      }

      const requested = new URLSearchParams(window.location.search).get("screen");
      if (requested !== null) return; // deep-links always win

      const { progress } = useCurriculumStore.getState();
      switch (settings.launchBehavior) {
        case "current-lesson": {
          const lesson = currentLesson(progress);
          if (lesson !== null) {
            useUiStore.getState().navigate("typing-session", {
              "typing-session": { lessonId: lesson.id },
            });
          }
          break;
        }
        case "last-screen":
          useUiStore.getState().navigate(settings.lastScreen);
          break;
        default:
          break; // dashboard is the initial screen already
      }
    });
  }, [hydrateSettings]);

  // §20 "last screen": persist the active screen for the launch behavior.
  useEffect(() => {
    useSettingsStore.getState().update({ lastScreen: activeScreen });
  }, [activeScreen]);

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
