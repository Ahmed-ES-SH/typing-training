import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";

import { connectTestDb } from "../lib/db/testing";
import { settingsRepo } from "../lib/db/repositories";
import {
  APP_SETTINGS_KEY,
  DEFAULT_SETTINGS,
  useSettingsStore,
} from "./useSettingsStore";

/**
 * §20 settings persistence: hydrate from the `settings` table, update with
 * merge + debounced persist, unknown/partial rows fall back to defaults.
 */

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = connectTestDb();
});

afterAll(() => {
  // Vitest module registry is per-file; resetting keeps other suites clean.
  useSettingsStore.setState({
    hydrated: false,
    settings: DEFAULT_SETTINGS,
  });
});

describe("useSettingsStore", () => {
  it("falls back to defaults when nothing is persisted", async () => {
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(useSettingsStore.getState().hydrated).toBe(true);
  });

  it("hydrates a persisted row and merges partial data over defaults", async () => {
    await settingsRepo.set(APP_SETTINGS_KEY, { theme: "terminal-mono", accentIntensity: 30 });
    await useSettingsStore.getState().hydrate();
    const settings = useSettingsStore.getState().settings;
    expect(settings.theme).toBe("terminal-mono");
    expect(settings.accentIntensity).toBe(30);
    // Untouched keys keep their defaults.
    expect(settings.backspacePolicy).toBe("counted");
    expect(settings.launchBehavior).toBe("dashboard");
  });

  it("rejects garbage rows and keeps defaults (never throws)", async () => {
    await settingsRepo.set(APP_SETTINGS_KEY, { theme: 42, accentIntensity: "loud" });
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it("persists updates (after the debounce window) merged over current state", async () => {
    await useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({ reduceMotion: true, heatmapWindow: "lifetime" });
    // In-memory state is immediate…
    expect(useSettingsStore.getState().settings.reduceMotion).toBe(true);
    // …persistence is debounced (~250ms).
    await new Promise((resolve) => setTimeout(resolve, 400));
    const raw = (await settingsRepo.get(APP_SETTINGS_KEY)) as Record<string, unknown>;
    expect(raw).toMatchObject({ reduceMotion: true, heatmapWindow: "lifetime" });
    expect(raw.theme).toBe(DEFAULT_SETTINGS.theme);

    void sqlite; // the harness DB instance (kept for parity with other suites)
  });
});
