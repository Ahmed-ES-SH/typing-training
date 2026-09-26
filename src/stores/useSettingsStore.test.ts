import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** ≥ the store's PERSIST_DEBOUNCE_MS (250, not exported) + a tick. */
const FLUSH_MS = 400;

beforeEach(() => {
  sqlite = connectTestDb();
});

afterEach(() => {
  vi.useRealTimers();
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

  it("hydrates a persisted row and ignores obsolete settings", async () => {
    await settingsRepo.set(APP_SETTINGS_KEY, { theme: "terminal-mono", accentIntensity: 30 });
    await useSettingsStore.getState().hydrate();
    const settings = useSettingsStore.getState().settings;
    expect(settings.theme).toBe("terminal-mono");
    expect(settings).not.toHaveProperty("accentIntensity");
    // Untouched keys keep their defaults.
    expect(settings.backspacePolicy).toBe("counted");
    expect(settings.launchBehavior).toBe("dashboard");
  });

  it("fills keys added after a legacy row was written with their defaults", async () => {
    // A row persisted before §4.1 shipped (no zenMode / whitespaceGlyphs).
    await settingsRepo.set(APP_SETTINGS_KEY, { theme: "terminal-mono" });
    await useSettingsStore.getState().hydrate();
    const settings = useSettingsStore.getState().settings;
    expect(settings.theme).toBe("terminal-mono");
    expect(settings.zenMode).toBe(false);
    expect(settings.whitespaceGlyphs).toBe(true);
    // §6.1 detabifier — rows written before the key get the 2-space default.
    expect(settings.tabSize).toBe(2);
  });

  it("rejects garbage rows and keeps defaults (never throws)", async () => {
    await settingsRepo.set(APP_SETTINGS_KEY, { theme: 42, accentIntensity: "loud" });
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it("persists updates (after the debounce window) merged over current state", async () => {
    vi.useFakeTimers();
    await useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({ reduceMotion: true, heatmapWindow: "lifetime" });
    // In-memory state is immediate…
    expect(useSettingsStore.getState().settings.reduceMotion).toBe(true);
    // …persistence is debounced (~250ms) — advanced on the fake clock so the
    // suite keeps no wall-clock sleeps.
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    const raw = (await settingsRepo.get(APP_SETTINGS_KEY)) as Record<string, unknown>;
    expect(raw).toMatchObject({ reduceMotion: true, heatmapWindow: "lifetime" });
    expect(raw.theme).toBe(DEFAULT_SETTINGS.theme);

    void sqlite; // the harness DB instance (kept for parity with other suites)
  });

  it("ships the UX plan §4.1 Zen / whitespace defaults and round-trips them", async () => {
    vi.useFakeTimers();
    // §4.1.3 Zen Mode defaults off; §4.1.4 whitespace glyphs default on.
    expect(DEFAULT_SETTINGS.zenMode).toBe(false);
    expect(DEFAULT_SETTINGS.whitespaceGlyphs).toBe(true);

    await useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({ zenMode: true, whitespaceGlyphs: false });
    expect(useSettingsStore.getState().settings).toMatchObject({
      zenMode: true,
      whitespaceGlyphs: false,
    });
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    const raw = (await settingsRepo.get(APP_SETTINGS_KEY)) as Record<string, unknown>;
    expect(raw).toMatchObject({ zenMode: true, whitespaceGlyphs: false });
  });

  it("ships the UX plan §6.1 tab-size default, round-trips it, and stays strict 2|4", async () => {
    vi.useFakeTimers();
    expect(DEFAULT_SETTINGS.tabSize).toBe(2);

    await useSettingsStore.getState().hydrate();
    useSettingsStore.getState().update({ tabSize: 4 });
    expect(useSettingsStore.getState().settings.tabSize).toBe(4);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    const raw = (await settingsRepo.get(APP_SETTINGS_KEY)) as Record<string, unknown>;
    expect(raw.tabSize).toBe(4);

    // The schema is a strict 2|4 union — anything else is rejected on update.
    expect(() =>
      useSettingsStore.getState().update({ tabSize: 3 as unknown as 2 }),
    ).toThrow();
    expect(useSettingsStore.getState().settings.tabSize).toBe(4);
  });
});
