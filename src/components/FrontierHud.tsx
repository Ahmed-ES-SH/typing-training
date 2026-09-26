import { useEffect } from "react";

import { cn } from "../lib/cn";
import { masteryBar, type LevelMastery } from "../lib/curriculum/frontierNav";
import { isEditableFocused } from "../lib/session/focusShield";

/**
 * FrontierHud (UX plan §6.1) — the sticky "Resume Frontier" floating action
 * bar pinned to the bottom of the Lessons screen: active lesson label, the
 * frontier level's mastery meter (`Level 3 [========>-] 38/50`) and the
 * primary `[Enter] Resume Frontier` action.
 *
 * `left` is measured by the screen from its own scroll container so the bar
 * never slides under the collapsible NavSidebar (z-30); the screen also pads
 * the scroll container so the last cards stay reachable beneath it.
 */
export function FrontierHud({
  frontier,
  mastery,
  enabled,
  left,
  onResume,
}: {
  /** Module label + title of the active frontier lesson, null when cleared. */
  frontier: { moduleNo: string; title: string } | null;
  /** Completion summary of the frontier's level. */
  mastery: LevelMastery | null;
  /** False while the §6.4 milestone modal owns the keyboard. */
  enabled: boolean;
  /** Viewport-space left edge (content area), measured by the screen. */
  left: number;
  onResume: () => void;
}) {
  // §6.1: Enter resumes the frontier from anywhere on this screen. §4.1.4
  // focus shield first — the search input, any Command Palette field, a
  // focused <select> and any focused button/link keep their own Enter, so
  // the shortcut only fires when no control is claiming the key.
  useEffect(() => {
    if (!enabled || frontier === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableFocused()) return;
      // The level-filter <select> keeps its own Enter (its options are the
      // focused control's to commit) — same rule as the editable guard.
      if (document.activeElement instanceof HTMLSelectElement) return;
      // A button/link the user deliberately focused (Tab or click) keeps its
      // Enter — a lesson card's "Start Lesson" or a filter pill must activate
      // instead of resuming the frontier from under it.
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement) return;
      event.preventDefault();
      onResume();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, frontier, onResume]);

  const canResume = enabled && frontier !== null;

  return (
    <div
      style={{ left }}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-surface-container-highest/60 bg-surface-container-low/95 px-gutter-desktop py-space-sm shadow-[0_-6px_24px_rgba(0,0,0,0.45)] backdrop-blur-xl"
    >
      <div className="flex items-center justify-between gap-space-base">
        <div className="flex min-w-0 items-center gap-space-sm">
          <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-container/20 text-primary sm:flex">
            <span className="material-symbols-outlined text-[20px]">flag</span>
          </span>
          <div className="min-w-0">
            <span className="block font-code-sm text-[10px] uppercase tracking-widest text-on-surface-variant">
              Resume Frontier
            </span>
            <span className="block truncate font-body-md text-body-md font-semibold text-on-surface">
              {frontier !== null ? `${frontier.moduleNo} · ${frontier.title}` : "Curriculum cleared"}
            </span>
          </div>
        </div>

        {mastery !== null && (
          <div className="hidden flex-col md:flex">
            <div className="flex items-center gap-space-xs font-code-sm text-code-sm">
              <span className="text-on-surface-variant">Level {mastery.level}</span>
              <span className="font-semibold text-primary">{masteryBar(mastery.completed, mastery.total)}</span>
              <span className="text-on-surface">
                {mastery.completed}/{mastery.total}
              </span>
            </div>
            <div className="mt-1 h-1 w-56 overflow-hidden rounded-full bg-surface-container-highest">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  mastery.complete ? "bg-secondary" : "bg-primary-container",
                )}
                style={{ width: `${mastery.pct}%` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onResume}
          disabled={!canResume}
          className={cn(
            "flex shrink-0 items-center gap-space-xs rounded-lg px-space-base py-2 font-label-md transition-all",
            canResume
              ? "bg-primary-container font-bold text-on-primary-container shadow-lg hover:bg-secondary-container"
              : "cursor-not-allowed bg-surface-container-high text-on-surface-variant/60",
          )}
        >
          {canResume && (
            <span className="rounded bg-on-primary/15 px-1.5 py-0.5 font-code-sm text-code-sm">
              Enter
            </span>
          )}
          <span>{canResume ? "Resume Frontier" : "No active lesson"}</span>
        </button>
      </div>
    </div>
  );
}
