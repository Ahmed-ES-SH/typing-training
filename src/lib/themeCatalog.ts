import type { ThemeId } from "../stores/useSettingsStore";

/**
 * Every theme in cycle order, with its display label — the single source for
 * the Settings appearance pills and the palette's "Switch Theme" action
 * (§5.1), so adding a theme means editing exactly this list.
 */
export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "typekernel-dark", label: "TypeKernel Dark" },
  { id: "terminal-mono", label: "Terminal Mono" },
  { id: "high-contrast", label: "High Contrast" },
];

/** The theme one step forward in the cycle (unknown id → first theme). */
export function nextTheme(current: ThemeId): ThemeId {
  const index = THEMES.findIndex((theme) => theme.id === current);
  return THEMES[(index + 1) % THEMES.length].id;
}

export function themeLabel(id: ThemeId): string {
  return THEMES.find((theme) => theme.id === id)?.label ?? id;
}
