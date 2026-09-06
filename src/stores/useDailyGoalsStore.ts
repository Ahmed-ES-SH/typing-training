import { create } from "zustand";

import {
  DailyGoalBoundsSchema,
  dailyGoalsRepo,
  DEFAULT_GOAL_VALUES,
  type DailyGoalValues,
} from "../lib/stats/dailyGoalsRepo";

/**
 * Daily-goals store (Phase 8 plan §3.2) — the client-side view over the
 * `daily_goals` `default` row, following the Phase 7 settings-store pattern:
 * controls persist instantly (debounced — the design has no save button) and
 * survive restart. Hydration happens once at app boot.
 *
 * A target of 0 disables that goal (excluded from the met calculation).
 * Updates are Zod-validated BEFORE state changes (§23) — invalid input
 * throws to the caller (Settings surfaces it inline) and state is kept.
 */

const PERSIST_DEBOUNCE_MS = 250;

interface DailyGoalsState {
  hydrated: boolean;
  goals: DailyGoalValues;
  /** Loads the persisted defaults (once at boot); falls back to §18 built-ins. */
  hydrate: () => Promise<void>;
  /** Merges a patch and persists it (debounced). Throws on Zod violations. */
  update: (patch: Partial<DailyGoalValues>) => void;
  /** Re-reads the row (call after a backup restore / reset). */
  refresh: () => Promise<void>;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export const useDailyGoalsStore = create<DailyGoalsState>((set, get) => {
  const persist = (goals: DailyGoalValues): void => {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void dailyGoalsRepo.setDefaults(goals).catch(() => {
        // Persistence failures never crash the UI; in-memory state stays.
      });
    }, PERSIST_DEBOUNCE_MS);
  };

  return {
    hydrated: false,
    goals: { ...DEFAULT_GOAL_VALUES },

    hydrate: async () => {
      try {
        set({ goals: await dailyGoalsRepo.getDefaults(), hydrated: true });
      } catch {
        set({ hydrated: true });
      }
    },

    update: (patch) => {
      const merged = { ...get().goals, ...patch };
      const valid = DailyGoalBoundsSchema.parse({ date: "default", ...merged });
      const goals: DailyGoalValues = {
        minutesGoal: valid.minutesGoal,
        lessonsGoal: valid.lessonsGoal,
        charsGoal: valid.charsGoal,
      };
      set({ goals });
      persist(goals);
    },

    refresh: async () => {
      try {
        set({ goals: await dailyGoalsRepo.getDefaults() });
      } catch {
        // DB unavailable — keep the in-memory values.
      }
    },
  };
});
