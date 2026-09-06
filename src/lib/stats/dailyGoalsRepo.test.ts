import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { setDbForTests } from "../db/client";
import { connectTestDb } from "../db/testing";
import {
  DEFAULT_GOAL_VALUES,
  dailyGoalsRepo,
} from "./dailyGoalsRepo";

/**
 * dailyGoalsRepo tests (Phase 8 plan §3.1).
 *
 * Defaults read as §18 built-ins on a fresh DB (no seed write); Zod bounds
 * reject out-of-range goals before SQL; per-date overrides take precedence
 * over defaults and clear back to them.
 */

beforeEach(() => {
  connectTestDb();
});

afterAll(() => {
  setDbForTests(null);
});

describe("dailyGoalsRepo defaults", () => {
  it("reads built-in defaults on a fresh DB without seeding", async () => {
    expect(await dailyGoalsRepo.getDefaults()).toEqual({ ...DEFAULT_GOAL_VALUES });
    expect(await dailyGoalsRepo.allOverrides()).toEqual([]);
  });

  it("persists replacement defaults", async () => {
    await dailyGoalsRepo.setDefaults({ minutesGoal: 30, lessonsGoal: 5, charsGoal: 1000 });
    expect(await dailyGoalsRepo.getDefaults()).toEqual({
      minutesGoal: 30,
      lessonsGoal: 5,
      charsGoal: 1000,
    });
  });

  it("rejects out-of-range goals before SQL (0–480 min, 0–100 lessons, 0–100k chars)", async () => {
    await expect(
      dailyGoalsRepo.setDefaults({ minutesGoal: 481, lessonsGoal: 3, charsGoal: 500 }),
    ).rejects.toThrow();
    await expect(
      dailyGoalsRepo.setDefaults({ minutesGoal: 15, lessonsGoal: 101, charsGoal: 500 }),
    ).rejects.toThrow();
    await expect(
      dailyGoalsRepo.setDefaults({ minutesGoal: 15, lessonsGoal: 3, charsGoal: 100_001 }),
    ).rejects.toThrow();
    await expect(
      dailyGoalsRepo.setDefaults({ minutesGoal: -1, lessonsGoal: 3, charsGoal: 500 }),
    ).rejects.toThrow();
    // 0 disables a goal — always accepted.
    await expect(
      dailyGoalsRepo.setDefaults({ minutesGoal: 0, lessonsGoal: 0, charsGoal: 0 }),
    ).resolves.toEqual({ minutesGoal: 0, lessonsGoal: 0, charsGoal: 0 });
    // Failed writes leave the previous defaults untouched.
    expect(await dailyGoalsRepo.getDefaults()).toEqual({
      minutesGoal: 0,
      lessonsGoal: 0,
      charsGoal: 0,
    });
  });
});

describe("dailyGoalsRepo overrides", () => {
  it("override takes precedence over defaults, clear falls back", async () => {
    await dailyGoalsRepo.setDefaults({ minutesGoal: 15, lessonsGoal: 3, charsGoal: 500 });
    expect(await dailyGoalsRepo.resolveForDate("2026-09-05")).toEqual({
      minutesGoal: 15,
      lessonsGoal: 3,
      charsGoal: 500,
    });

    await dailyGoalsRepo.setOverride("2026-09-05", {
      minutesGoal: 60,
      lessonsGoal: 1,
      charsGoal: 0,
    });
    expect(await dailyGoalsRepo.resolveForDate("2026-09-05")).toEqual({
      minutesGoal: 60,
      lessonsGoal: 1,
      charsGoal: 0,
    });
    // Other dates still see the defaults.
    expect(await dailyGoalsRepo.resolveForDate("2026-09-06")).toEqual({
      minutesGoal: 15,
      lessonsGoal: 3,
      charsGoal: 500,
    });

    await dailyGoalsRepo.clearOverride("2026-09-05");
    expect(await dailyGoalsRepo.getOverride("2026-09-05")).toBeNull();
    expect(await dailyGoalsRepo.resolveForDate("2026-09-05")).toEqual({
      minutesGoal: 15,
      lessonsGoal: 3,
      charsGoal: 500,
    });
  });

  it("rejects malformed dates and default-row misuse", async () => {
    await expect(
      dailyGoalsRepo.setOverride("not-a-date", { minutesGoal: 1, lessonsGoal: 1, charsGoal: 1 }),
    ).rejects.toThrow();
    await expect(
      dailyGoalsRepo.setOverride("default", { minutesGoal: 1, lessonsGoal: 1, charsGoal: 1 }),
    ).rejects.toThrow();
    await expect(dailyGoalsRepo.clearOverride("default")).rejects.toThrow();
  });
});
