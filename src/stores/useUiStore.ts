import { create } from "zustand";

import type { ScreenId } from "../lib/screens";
import { SCREEN_IDS } from "../lib/screens";

/**
 * Global UI state: which screen is active, plus per-screen navigation
 * parameters (Phase 4 plan §3.8 — extending, not rewriting, the Phase 2
 * store). No router dependency — zustand remains the single source of truth
 * for navigation.
 */

export interface TypingSessionParams {
  lessonId: string;
}

export interface LessonResultsParams {
  /** Attempt row id; null when persistence failed and only the in-memory
   * summary is available. */
  attemptId: number | null;
}

export type NavParams = {
  "typing-session"?: TypingSessionParams;
  "lesson-results"?: LessonResultsParams;
};

interface UiState {
  activeScreen: ScreenId;
  params: NavParams;
  navigate: (screenId: ScreenId, params?: NavParams) => void;
}

/** Deep-link support: `?screen=<id>` opens directly on that screen. */
function initialScreen(): ScreenId {
  if (typeof window !== "undefined") {
    const requested = new URLSearchParams(window.location.search).get("screen");
    if (requested !== null && (SCREEN_IDS as readonly string[]).includes(requested)) {
      return requested as ScreenId;
    }
  }
  return "dashboard";
}

export const useUiStore = create<UiState>((set) => ({
  activeScreen: initialScreen(),
  params: {},
  navigate: (activeScreen, params) =>
    set({ activeScreen, params: params ?? {} }),
}));
