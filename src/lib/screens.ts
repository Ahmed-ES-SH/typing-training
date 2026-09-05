/**
 * Screen registry — the eight top-level screens of the app (PRD §20).
 *
 * The `icon` field holds a Material Symbols Outlined ligature name, matching
 * the icon language of the `screens/*_typekernel` designs.
 */

export const SCREEN_IDS = [
  "dashboard",
  "lessons",
  "typing-session",
  "lesson-results",
  "statistics",
  "weakness-training",
  "custom-lessons",
  "settings",
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

export interface ScreenMeta {
  id: ScreenId;
  /** Terminal-style label used in breadcrumbs and placeholder notes. */
  label: string;
  /** Material Symbols Outlined ligature name. */
  icon: string;
}

export const SCREENS: readonly ScreenMeta[] = [
  { id: "dashboard", label: "operator_status", icon: "space_dashboard" },
  { id: "lessons", label: "curriculum", icon: "checklist" },
  { id: "typing-session", label: "live_training", icon: "keyboard" },
  { id: "lesson-results", label: "attempt_report", icon: "fact_check" },
  { id: "statistics", label: "performance_analytics", icon: "monitoring" },
  { id: "weakness-training", label: "weakness_drills", icon: "monitor_heart" },
  { id: "custom-lessons", label: "custom_modules", icon: "construction" },
  { id: "settings", label: "system_config", icon: "settings" },
];

export function getScreen(id: ScreenId): ScreenMeta {
  return SCREENS.find((screen) => screen.id === id)!;
}
