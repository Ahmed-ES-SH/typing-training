import type { KeyboardLayout } from "./keymap";
import { QWERTY_US } from "./qwerty";

/**
 * Active-layout accessor (PRD §19) — the SINGLE place a layout is chosen.
 * QWERTY now; the Settings screen (Phase 7) swaps it here and everything
 * downstream (engine UI, keyboard visualization, heatmap) follows.
 */
export function getActiveLayout(): KeyboardLayout {
  return QWERTY_US;
}

export * from "./keymap";
export * from "./fingers";
