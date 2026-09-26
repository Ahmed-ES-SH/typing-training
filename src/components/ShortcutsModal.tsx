import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts cheat sheet (UX plan §5.2.2 — "`?` → Keyboard Shortcuts
 * Cheat Sheet modal"). Renders the §10 keybinding reference matrix verbatim,
 * including the Phase 1 golden-loop keys and the Phase 4 weakness keys, so
 * discoverability is one keystroke away from anywhere.
 *
 * Escape is claimed in the CAPTURE phase and every other unmodified key is
 * swallowed there: while the sheet is open the Results `D`/`Enter`, the
 * session `Esc` and the drill `Space` handlers must never fire behind it.
 * Modifier chords (and `/`, `?`) still pass through so `Ctrl+K`, `Alt+1..6`
 * keep working with the sheet up.
 *
 * Tab is consumed in the same capture phase and cycles focus inside the
 * sheet (dialog ⇄ close button): the sheet mounts last, so an unconsumed
 * Tab would wrap to the TopBar "Close" traffic dot, where Space/Enter
 * quits the app. Focus is restored to the opener on close.
 *
 * With overlays stacked (a confirm Modal underneath this sheet or the
 * palette), every one of these handlers first checks that its OWN dialog is
 * the LAST `[role="dialog"][aria-modal="true"]` in document order — capture
 * listeners run in registration order, so without that check the overlay
 * opened first would answer Esc/Tab while the top one stayed open.
 */

interface ShortcutRow {
  /** One badge per chord, e.g. "Ctrl+K" or "g d". */
  chords: string[];
  action: string;
  benefit: string;
}

interface ShortcutSection {
  scope: string;
  icon: string;
  rows: ShortcutRow[];
}

/** Exported for the chord-drift test (`ShortcutsModal.test.ts`). */
export const SECTIONS: ShortcutSection[] = [
  {
    scope: "Global",
    icon: "keyboard_command_key",
    rows: [
      {
        chords: ["Ctrl+K", "Cmd+K"],
        action: "Open Command Palette",
        benefit: "Instant jump to any lesson, screen, or setting.",
      },
      {
        chords: ["/"],
        action: "Open Command Palette",
        benefit: "Hand on the home row — outside a typing session.",
      },
      {
        chords: ["Alt+1 … Alt+6"],
        action: "Direct Screen Switch",
        benefit: "1-key navigation across the 6 main views.",
      },
      {
        chords: ["g d", "g l", "g w", "g s", "g c", "g ,"],
        action: "Vim Screen Jump",
        benefit: "Home-row navigation for Vim / terminal typists.",
      },
      {
        chords: ["?"],
        action: "Show Shortcuts Modal",
        benefit: "Instant discoverability for power features.",
      },
    ],
  },
  {
    scope: "Session",
    icon: "keyboard",
    rows: [
      {
        chords: ["F", "Ctrl+Shift+F"],
        action: "Toggle Zen / Focus Mode",
        benefit: "Maximizes code buffer, hides distractions.",
      },
      {
        chords: ["Tab + Enter", "Ctrl+R"],
        action: "Instant Buffer Reset",
        benefit: "Immediate retry without mouse reach.",
      },
      {
        chords: ["Esc"],
        action: "Abandon & Return",
        benefit: "Clean, safe exit back to curriculum.",
      },
      {
        chords: ["H", "Ctrl+Shift+H"],
        action: "Toggle Heatmap Glance",
        benefit: "Bare H when idle, chord mid-run — never eats lesson keys.",
      },
    ],
  },
  {
    scope: "Results",
    icon: "fact_check",
    rows: [
      {
        chords: ["Enter"],
        action: "Advance to Next Lesson (Pass)",
        benefit: "Continuous forward momentum on success.",
      },
      {
        chords: ["Enter", "Space"],
        action: "Instant Retry (Fail)",
        benefit: "Zero-friction immediate second attempt.",
      },
      {
        chords: ["D"],
        action: "Launch 45s Micro-Drill",
        benefit: "Targeted fix for the exact keys failed.",
      },
      {
        chords: ["Space"],
        action: "Replay for PR (Pass)",
        benefit: "Polish speed without advancing.",
      },
      {
        chords: ["Esc"],
        action: "Return to Curriculum",
        benefit: "Overview view.",
      },
    ],
  },
  {
    scope: "Dashboard",
    icon: "space_dashboard",
    rows: [
      {
        chords: ["Enter"],
        action:
          "Start Daily Routine (Resume Frontier once it is complete)",
        benefit: "0-click entry into the daily habit loop.",
      },
    ],
  },
  {
    scope: "Weakness",
    icon: "monitor_heart",
    rows: [
      {
        chords: ["Space", "Enter"],
        action: "Advance to Next Set",
        benefit: "Flow-state drill progression — 1.5s countdown, skip anytime.",
      },
    ],
  },
];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"])';

/** Every element Tab may land on inside the sheet, dialog first. */
function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)),
  ];
}

export function ShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Focus the sheet so its own key handling is active the moment it opens;
  // mousedown inside is prevented below, so focus never wanders back out.
  // The opener is captured first and handed focus back on close — dropping
  // focus on <body> would strand keyboard users (and the next Tab).
  useEffect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    return () => {
      if (
        previous !== null &&
        previous !== document.body &&
        previous.isConnected
      ) {
        previous.focus();
      }
    };
  }, [open]);

  // Capture-phase keyboard shield (see the header comment).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const root = dialogRef.current;
      if (root === null) return;
      // Stacked overlays: capture listeners fire in registration order, so the
      // sheet must never claim a key that belongs to an overlay opened after
      // it (or hand Esc/Tab back to a modal buried underneath it). Only the
      // topmost dialog — the last one in document order — owns the keyboard.
      const dialogs = document.querySelectorAll(
        '[role="dialog"][aria-modal="true"]',
      );
      if (dialogs[dialogs.length - 1] !== root) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        // Focus trap: consume Tab and cycle dialog ⇄ close button, so focus
        // can never wrap out to the TopBar traffic dots (Space/Enter there
        // closes the app). Same "modal owns the keyboard" rule as the
        // palette's Tab handling.
        event.preventDefault();
        event.stopPropagation();
        const items = focusablesIn(root);
        const current = items.indexOf(document.activeElement as HTMLElement);
        const delta = event.shiftKey ? -1 : 1;
        const next =
          items[(current + delta + items.length) % items.length] ?? items[0];
        next?.focus();
        return;
      }
      const isGlobalChord =
        event.ctrlKey || event.metaKey || event.altKey ||
        event.key === "/" || event.key === "?";
      if (!isGlobalChord) event.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-space-base backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-primary-container/40 bg-surface-container-low shadow-2xl focus:outline-none"
      >
        <div className="flex items-center justify-between border-b border-surface-container-highest/40 bg-surface-container-lowest/60 px-space-base py-space-sm">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-[18px] text-primary">
              keyboard
            </span>
            <h2 className="font-headline-md text-headline-md text-on-surface">
              Keyboard Shortcuts
            </h2>
            <span className="font-code-sm text-code-sm text-outline">
              keybinding reference (plan §10)
            </span>
          </div>
          <button
            type="button"
            aria-label="Close shortcuts"
            onClick={onClose}
            className="rounded bg-surface-container-lowest p-1 text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-space-base overflow-y-auto px-space-base py-space-base">
          {SECTIONS.map((section) => (
            <section key={section.scope}>
              <h3 className="mb-space-xs flex items-center gap-space-xs font-code-sm text-code-sm uppercase tracking-widest text-primary">
                <span className="material-symbols-outlined text-[14px]">
                  {section.icon}
                </span>
                {section.scope}
              </h3>
              <ul className="flex flex-col gap-0.5">
                {section.rows.map((row) => (
                  <li
                    key={`${section.scope}-${row.action}-${row.chords.join()}`}
                    className="flex items-center justify-between gap-space-base rounded-lg px-space-sm py-1.5 hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0">
                      <div className="font-body-md text-body-md text-on-surface">
                        {row.action}
                      </div>
                      <div className="font-code-sm text-code-sm text-outline">
                        {row.benefit}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                      {row.chords.map((chord) => (
                        <kbd
                          key={chord}
                          className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 font-code-sm text-code-sm text-on-surface-variant"
                        >
                          {chord}
                        </kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-surface-container-highest/40 bg-surface-container-lowest/40 px-space-base py-space-sm font-code-sm text-code-sm text-outline">
          <span>
            Global keys never fire inside a text field or a typing run — except
            Ctrl+K.
          </span>
          <span className="flex items-center gap-space-xs">
            <kbd className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[10px]">
              ?
            </kbd>
            <span>or</span>
            <kbd className="rounded border border-white/10 bg-surface-container-low px-1.5 py-0.5 text-[10px]">
              Esc
            </kbd>
            <span>to close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
