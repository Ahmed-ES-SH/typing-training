import { z } from "zod";

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
  /** Clean title-case label used in breadcrumbs and navigation. */
  label: string;
  /** Material Symbols Outlined ligature name. */
  icon: string;
}

export const SCREENS: readonly ScreenMeta[] = [
  { id: "dashboard", label: "Dashboard", icon: "space_dashboard" },
  { id: "lessons", label: "Lessons", icon: "checklist" },
  { id: "typing-session", label: "Training", icon: "keyboard" },
  { id: "lesson-results", label: "Results", icon: "fact_check" },
  { id: "statistics", label: "Statistics", icon: "monitoring" },
  { id: "weakness-training", label: "Weakness", icon: "monitor_heart" },
  { id: "custom-lessons", label: "Custom", icon: "construction" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function getScreen(id: ScreenId): ScreenMeta {
  return SCREENS.find((screen) => screen.id === id)!;
}

/** Zod mirror of {@link ScreenId} (settings persistence uses it directly). */
export const ScreenIdSchema = z.enum(SCREEN_IDS);
