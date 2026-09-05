import { create } from "zustand";

import type { ScreenId } from "../lib/screens";

/**
 * Global UI state: which screen is active.
 *
 * No router dependency (MAIN_PLAN decision) — zustand is the single source of
 * truth for navigation. Navigation parameters (lesson id, attempt id, ...)
 * will be added by later phases when the screens need them.
 */
interface UiState {
  activeScreen: ScreenId;
  navigate: (screenId: ScreenId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeScreen: "dashboard",
  navigate: (activeScreen) => set({ activeScreen }),
}));
