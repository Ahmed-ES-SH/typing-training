import type { Lesson, DrillConfig } from "../schemas";
import { DrillConfigSchema } from "../schemas";
import { settingsRepo } from "../db/repositories";
import { focusKeysOf, type WeaknessAnalysis } from "./analyzer";
import { generateDrillSets, hashSeed, type GeneratedSet } from "./adaptiveGenerator";

/**
 * Weakness drill service (PRD §15; Phase 6 plan §3.4).
 *
 * A drill = `config.sets` generated sets (default 5 × 120 keystrokes, the
 * design's "SET 3 OF 5" / "120 keys"). Each set runs through the Phase 3
 * engine UNCHANGED; per-set stats and focus-key hit accounting are pure
 * derivations over the engine state. Persistence (kind='weakness' attempts,
 * key-stat rollups, training_sessions) lives in the session store's finish
 * pipeline — this module owns composition, config and accounting only.
 *
 * Drill config (the design's 4 rows) is persisted in `settings` under
 * `drill_config`; the defaults are the design's values. No editing UI until
 * Phase 7's Settings screen.
 */

export const DRILL_CONFIG_KEY = "drill_config";

/** Defaults per the design: 120 keys / 5 sets / AGGRESSIVE ×3 /
 * code identifiers / counted backspaces. */
export const DEFAULT_DRILL_CONFIG: DrillConfig = {
  setLength: 120,
  sets: 5,
  symbolWeight: 3,
  wordContext: "code_identifiers",
  backspacePolicy: "counted",
} as const;

/** Loads the drill config, falling back to the design defaults (and
 * healing invalid persisted shapes). */
export async function getDrillConfig(): Promise<DrillConfig> {
  const raw = await settingsRepo.get(DRILL_CONFIG_KEY);
  const parsed = DrillConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_DRILL_CONFIG };
}

/** Persists the drill config (used by tests now, Settings screen in Phase 7). */
export async function setDrillConfig(config: DrillConfig): Promise<void> {
  const valid = DrillConfigSchema.parse(config);
  await settingsRepo.set(DRILL_CONFIG_KEY, valid);
}

/** A fully composed drill: all sets up-front + focus keys + config. */
export interface DrillPlan {
  seed: number;
  config: DrillConfig;
  /** The chars this drill targets (design: "FOCUS: { : ]"). */
  focusKeys: string[];
  sets: Lesson[];
  /** Per-set generator metadata (weak chars actually injected). */
  weakChars: string[][];
}

/**
 * Composes the drill plan from an analysis. Deterministic per
 * (analysis, seed): set i is generated with (seed, i) — the REGENERATE
 * action only supplies a fresh seed.
 */
export function buildDrillPlan(
  analysis: WeaknessAnalysis,
  config: DrillConfig,
  seed: number,
  userLevel: number,
): DrillPlan {
  const focus = focusKeysOf(analysis, 3).map((t) => t.key);
  const generated: GeneratedSet[] = generateDrillSets(
    { analysis, config, seed, userLevel },
    config.sets,
  );
  return {
    seed,
    config,
    focusKeys: focus,
    sets: generated.map((g) => g.lesson),
    weakChars: generated.map((g) => g.weakChars),
  };
}

/** Fresh seed from wall-clock (REGENERATE / Start actions). */
export function newDrillSeed(now = Date.now()): number {
  return hashSeed(now, Math.random()) % 0x7fffffff;
}

export interface FocusKeyStats {
  /** Keystrokes on focus chars that were typed correctly. */
  hits: number;
  /** Keystrokes on focus chars that were mistyped. */
  misses: number;
  /** All focus-char keystrokes (design: "61/72"). */
  total: number;
  /** Misses on the FIRST focus char (design: "9 misses on {"). */
  leadMisses: number;
}

/**
 * Focus-key hit accounting over an engine state's key events — pure, so the
 * design's "Focus Key Hits x/y, 9 misses on {" cards are trivially testable.
 */
export function focusKeyStatsOf(
  keyEvents: readonly { expected: string; correct: boolean }[],
  focusKeys: string[],
): FocusKeyStats {
  const focus = new Set(focusKeys);
  const lead = focusKeys[0];
  let hits = 0;
  let misses = 0;
  let leadMisses = 0;
  for (const event of keyEvents) {
    if (!focus.has(event.expected)) continue;
    if (event.correct) {
      hits += 1;
    } else {
      misses += 1;
      if (event.expected === lead) leadMisses += 1;
    }
  }
  return { hits, misses, total: hits + misses, leadMisses };
}
