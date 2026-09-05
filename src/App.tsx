import { useEffect } from "react";
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
import StatisticsScreen from "./screens/StatisticsScreen";
import TypingSessionScreen from "./screens/TypingSessionScreen";
import WeaknessTrainingScreen from "./screens/WeaknessTrainingScreen";

/** Screen id -> component. Screens are cheap stubs; no lazy loading yet. */
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
      <ActiveScreen />
    </Shell>
  );
}

export default App;
