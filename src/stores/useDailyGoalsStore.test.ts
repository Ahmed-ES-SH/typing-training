import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { connectTestDb } from "../lib/db/testing";
import { setDbForTests } from "../lib/db/client";
import { dailyGoalsRepo, DEFAULT_GOAL_VALUES } from "../lib/stats/dailyGoalsRepo";
import { useDailyGoalsStore } from "./useDailyGoalsStore";

/**
 * Daily-goals store (Phase 8 plan §3.2): hydrate from the `daily_goals`
 * default row, instant (debounced) persist, Zod validation before state
 * changes — invalid patches throw and keep prior state.
 */

beforeEach(() => {
  connectTestDb();
});

afterAll(() => {
  setDbForTests(null);
  useDailyGoalsStore.setState({
    hydrated: false,
    goals: { ...DEFAULT_GOAL_VALUES },
  });
});

describe("useDailyGoalsStore", () => {
  it("falls back to §18 built-ins when nothing is persisted", async () => {
    await useDailyGoalsStore.getState().hydrate();
    expect(useDailyGoalsStore.getState().goals).toEqual({ ...DEFAULT_GOAL_VALUES });
    expect(useDailyGoalsStore.getState().hydrated).toBe(true);
  });

  it("hydrates a persisted default row", async () => {
    await dailyGoalsRepo.setDefaults({ minutesGoal: 30, lessonsGoal: 5, charsGoal: 2000 });
    await useDailyGoalsStore.getState().hydrate();
    expect(useDailyGoalsStore.getState().goals).toEqual({
      minutesGoal: 30,
      lessonsGoal: 5,
      charsGoal: 2000,
    });
  });

  it("rejects out-of-range patches before state changes", async () => {
    await useDailyGoalsStore.getState().hydrate();
    const before = useDailyGoalsStore.getState().goals;
    expect(() => useDailyGoalsStore.getState().update({ minutesGoal: 481 })).toThrow();
    expect(() => useDailyGoalsStore.getState().update({ lessonsGoal: -1 })).toThrow();
    expect(useDailyGoalsStore.getState().goals).toEqual(before);
  });

  it("persists updates after the debounce window (0 disables a goal)", async () => {
    await useDailyGoalsStore.getState().hydrate();
    useDailyGoalsStore.getState().update({ minutesGoal: 0, lessonsGoal: 2, charsGoal: 250 });
    expect(useDailyGoalsStore.getState().goals).toEqual({
      minutesGoal: 0,
      lessonsGoal: 2,
      charsGoal: 250,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(await dailyGoalsRepo.getDefaults()).toEqual({
      minutesGoal: 0,
      lessonsGoal: 2,
      charsGoal: 250,
    });
  });
});
