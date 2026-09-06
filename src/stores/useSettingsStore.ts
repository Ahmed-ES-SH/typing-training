import { create } from "zustand";

import { settingsRepo } from "../lib/db/repositories";
import { z } from "zod";
import { ScreenIdSchema } from "../lib/screens";

/**
 * Settings store (§20, Phase 7) — the client-side view over the `settings`
 * table's `app_settings` row. Every control persists immediately (debounced
 * — the design has no save button) and survives restart. Hydration happens
 * once at app boot; side effects (theme class, reduce-motion attribute,
 * accent-alpha CSS var) apply to the document root on every change so all
 * screens and components follow instantly.
 */

export const ThemeIdSchema = z.enum(["typekernel-dark", "terminal-mono", "high-contrast"]);
export type ThemeId = z.infer<typeof ThemeIdSchema>;

export const ReferenceOffsetSchema = z.enum(["ansi", "iso", "compact60"]);
export type ReferenceOffset = z.infer<typeof ReferenceOffsetSchema>;

export const LaunchBehaviorSchema = z.enum(["dashboard", "current-lesson", "last-screen"]);
export type LaunchBehavior = z.infer<typeof LaunchBehaviorSchema>;

/** Heatmap rolling window (statistics preference, §20). */
export const HeatmapWindowSchema = z.enum(["30d", "lifetime"]);

export const AppSettingsSchema = z.object({
  /* Keyboard layout (§19 — QWERTY active; others "coming soon"). */
  layout: z.enum(["qwerty", "dvorak", "colemak"]).default("qwerty"),
  fingerGuides: z.boolean().default(true),
  highlightNextKey: z.boolean().default(true),
  referenceOffset: ReferenceOffsetSchema.default("ansi"),

  /* Appearance. */
  theme: ThemeIdSchema.default("typekernel-dark"),
  accentIntensity: z.number().int().min(0).max(100).default(70),
  editorFont: z.enum(["jetbrains-mono", "fira-code", "cascadia-code"]).default("jetbrains-mono"),
  reduceMotion: z.boolean().default(false),

  /* Training preferences. Strict mode is §8 product law — not a setting. */
  backspacePolicy: z.enum(["counted", "free", "forbidden"]).default("counted"),
  adaptiveLessons: z.boolean().default(true),
  soundFeedback: z.boolean().default(false),

  /* Statistics preferences. */
  statsDefaultRange: z.enum(["30d", "90d", "all"]).default("30d"),
  heatmapWindow: HeatmapWindowSchema.default("30d"),
  showTelemetryStrip: z.boolean().default(true),

  /* Application behavior. */
  launchBehavior: LaunchBehaviorSchema.default("dashboard"),
  lastScreen: ScreenIdSchema.default("dashboard"),
  /** Last successful backup export (Data Management read-out). */
  lastBackupAt: z.number().int().nonnegative().nullable().default(null),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = AppSettingsSchema.parse({});

export const APP_SETTINGS_KEY = "app_settings";

/** Persist debounce (ms) — typing on the accent slider must not thrash SQL. */
const PERSIST_DEBOUNCE_MS = 250;

interface SettingsState {
  hydrated: boolean;
  settings: AppSettings;
  /** Loads the persisted row (once at boot); falls back to defaults. */
  hydrate: () => Promise<void>;
  /** Merges a patch, applies side effects, persists (debounced). */
  update: (patch: Partial<AppSettings>) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Root side effects: theme token overrides, motion, accent glow strength. */
function applyDocumentSettings(settings: AppSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove(
    "theme-typekernel-dark",
    "theme-terminal-mono",
    "theme-high-contrast",
  );
  root.classList.add(`theme-${settings.theme}`);
  root.dataset.motion = settings.reduceMotion ? "reduced" : "full";
  // Accent glow scale: 1.0 at the design's default 70% intensity (0 at 0%,
  // clamped by the browser above ~1.4 at 100%).
  root.style.setProperty("--accent-alpha", String(settings.accentIntensity / 70));
  // Editor font (§20): the bundled JetBrains Mono is the only selectable
  // stack today; the token override is already wired for future bundling.
  const fontStack =
    settings.editorFont === "fira-code"
      ? '"Fira Code", "JetBrains Mono", ui-monospace, monospace'
      : settings.editorFont === "cascadia-code"
        ? '"Cascadia Code", "JetBrains Mono", ui-monospace, monospace'
        : '"JetBrains Mono", ui-monospace, monospace';
  for (const token of [
    "--font-code-sm",
    "--font-code-md",
    "--font-code-lg",
    "--font-label-sm",
    "--font-code-current",
  ]) {
    root.style.setProperty(token, fontStack);
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const persist = (settings: AppSettings): void => {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void settingsRepo.set(APP_SETTINGS_KEY, settings).catch(() => {
        // Persistence failures never crash the UI; the in-memory state stays.
      });
    }, PERSIST_DEBOUNCE_MS);
  };

  return {
    hydrated: false,
    settings: DEFAULT_SETTINGS,

    hydrate: async () => {
      try {
        const raw = await settingsRepo.get(APP_SETTINGS_KEY);
        const parsed = AppSettingsSchema.safeParse(raw);
        const settings = parsed.success ? parsed.data : DEFAULT_SETTINGS;
        applyDocumentSettings(settings);
        set({ settings, hydrated: true });
      } catch {
        // DB unavailable (browser preview): defaults still apply to the DOM.
        applyDocumentSettings(get().settings);
        set({ hydrated: true });
      }
    },

    update: (patch) => {
      const settings = AppSettingsSchema.parse({ ...get().settings, ...patch });
      applyDocumentSettings(settings);
      set({ settings });
      persist(settings);
    },
  };
});
