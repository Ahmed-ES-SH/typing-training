import { lazy, Suspense, useEffect } from "react";
import type { ComponentType } from "react";

import { Shell } from "./components/Shell";
import { NavSidebar } from "./components/NavSidebar";
import { TopBar } from "./components/TopBar";
import type { ScreenId } from "./lib/screens";
import { getScreen } from "./lib/screens";
import { useCurriculumStore, currentLesson } from "./stores/useCurriculumStore";
import { useDailyGoalsStore } from "./stores/useDailyGoalsStore";
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
  const hydrateGoals = useDailyGoalsStore((state) => state.hydrate);
  const ActiveScreen = SCREEN_COMPONENTS[activeScreen];

  // Window title follows the active screen (Phase 8 polish §3.5).
  useEffect(() => {
    const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
    const screenName = getScreen(activeScreen).label.split("_").map(titleCase).join(" ");
    document.title = `TypeKernel — ${screenName}`;
  }, [activeScreen]);

  // Phase 4 startup: seed the 260-lesson curriculum and load progress rows
  // (idempotent; failures surface as a graceful in-app error state).
  // Phase 7: hydrate preferences from the settings table, then apply the
  // §20 launch behavior once the curriculum is ACTUALLY loaded (awaiting
  // bootstrap here — a fire-and-forget bootstrap loses the race and the
  // "current-lesson" launch silently no-ops). Phase 8 hydrates the
  // daily-goal defaults alongside (single boot, no extra paint blocked).
  useEffect(() => {
    void Promise.all([hydrateSettings(), hydrateGoals(), bootstrap()]).then(() => {
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

      performance.mark("typekernel:first-screen-ready");
      performance.measure(
        "typekernel:boot-to-screen",
        "typekernel:main-start",
        "typekernel:first-screen-ready",
      );
      if (import.meta.env.DEV) {
        const [measure] = performance.getEntriesByName("typekernel:boot-to-screen");
        // eslint-disable-next-line no-console
        console.info(
          `[perf] main → first screen data ready: ${measure?.duration.toFixed(1) ?? "?"} ms (budget ≤ 1500 ms)`,
        );
      }
    });
  }, [hydrateSettings, hydrateGoals, bootstrap]);

  // §20 "last screen": persist the active screen for the launch behavior.
  useEffect(() => {
    useSettingsStore.getState().update({ lastScreen: activeScreen });
  }, [activeScreen]);

  return (
    <Shell>
      <TopBar />
      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        <NavSidebar />
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
      </div>
    </Shell>
  );
}

export default App;
