import { useEffect } from "react";

import { Modal } from "./Modal";
import { KernelButton } from "./FormPrimitives";
import { fmt1 } from "../lib/format";
import type { LevelMastery } from "../lib/curriculum/frontierNav";
import { isEditableFocused } from "../lib/session/focusShield";

/**
 * LevelMilestoneModal (UX plan §6.4) — the golden "Level Complete" card
 * shown when a curriculum level hits 100%. Reuses the shared `Modal` shell
 * (portal-less overlay, Esc + backdrop dismiss) and adds the §6.4 keyboard
 * contract: Enter = primary action (advance to the next level).
 *
 * The screen decides WHICH level is celebrated (`nextMilestoneToCelebrate`)
 * and acknowledges it in localStorage, so this component only renders.
 */
export function LevelMilestoneModal({
  mastery,
  stats,
  nextLevel,
  onAdvance,
  onReviewWeakKeys,
  onClose,
}: {
  mastery: LevelMastery;
  /** Average best stats over the level's attempted lessons, null if none. */
  stats: { wpm: number; accuracy: number } | null;
  /** The following level, or null when the curriculum's final level fell. */
  nextLevel: number | null;
  onAdvance: () => void;
  onReviewWeakKeys: () => void;
  onClose: () => void;
}) {
  const primaryLabel =
    nextLevel !== null ? `Advance to Level ${nextLevel}` : "Back to Curriculum";
  const primaryAction = nextLevel !== null ? onAdvance : onClose;

  // Enter = primary action. §4.1.4 focus shield first (the modal has no
  // editable fields, but a palette/search field could still own focus), and
  // a button the user deliberately focused (Tab or click) keeps its own
  // Enter — "Review Weak Keys" must activate instead of advancing the level.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isEditableFocused()) return;
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement) return;
      event.preventDefault();
      primaryAction();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [primaryAction]);

  return (
    <Modal
      title={`Level ${mastery.level} Mastered`}
      onClose={onClose}
      actions={
        <>
          <KernelButton icon="monitor_heart" onClick={onReviewWeakKeys}>
            Review Weak Keys
          </KernelButton>
          <KernelButton
            variant="primary"
            icon={nextLevel !== null ? "arrow_forward" : "school"}
            onClick={primaryAction}
          >
            <span className="rounded bg-on-primary/20 px-1.5 py-0.5 font-code-sm text-code-sm">
              Enter
            </span>
            {primaryLabel}
          </KernelButton>
        </>
      }
    >
      <div className="flex flex-col items-center gap-space-base py-space-sm text-center">
        <span
          className="material-symbols-outlined text-[56px] text-amber-300"
          style={{ fontVariationSettings: "'FILL' 1" }}
        >
          emoji_events
        </span>
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 font-code-sm text-code-sm uppercase tracking-widest text-amber-300">
          {mastery.tier !== "" ? mastery.tier : `Level ${mastery.level}`} tier
        </span>
        <h3 className="font-headline-lg text-headline-lg text-on-surface">{mastery.name}</h3>
        <p className="max-w-md font-body-md text-body-md text-on-surface-variant">
          Every lesson in this level cleared the gate —{" "}
          <strong className="text-on-surface">
            {mastery.completed}/{mastery.total}
          </strong>{" "}
          mastered.
        </p>
        <div className="flex items-center gap-space-lg rounded-lg bg-surface-container-lowest px-space-base py-space-sm font-code-sm text-code-sm">
          <div className="text-right">
            <span className="block text-on-surface-variant">Avg Speed</span>
            <span className="font-semibold text-on-surface">
              {stats !== null ? `${fmt1(stats.wpm)} WPM` : "—"}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-on-surface-variant">Avg Accuracy</span>
            <span className="font-semibold text-on-surface">
              {stats !== null ? `${fmt1(stats.accuracy)}%` : "—"}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-on-surface-variant">Mastery</span>
            <span className="font-semibold text-secondary">{mastery.pct}%</span>
          </div>
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          {nextLevel !== null
            ? `Level ${nextLevel} is unlocked — keep the streak going.`
            : "That is the whole curriculum. Nothing left but personal records."}
        </p>
      </div>
    </Modal>
  );
}
