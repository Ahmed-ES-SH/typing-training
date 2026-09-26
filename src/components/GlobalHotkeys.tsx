import { useCallback, useEffect, useRef, useState } from "react";

import { CommandPalette } from "./CommandPalette";
import { ShortcutsModal } from "./ShortcutsModal";
import {
  globalHotkeyDecision,
  type GlobalHotkeyAction,
} from "../lib/hotkeys/globalHotkeys";
import { isEditableFocused, releaseChromeFocus } from "../lib/session/focusShield";
import { useSessionStore } from "../stores/useSessionStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Global hotkey host (UX plan §5.2, keybinding matrix §10) — mounts the one
 * window `keydown` listener that owns `Ctrl/Cmd+K`, `Alt+1..6`, `/`, `?` and
 * the vim `g …` chords, and holds the open-state of the two overlays it
 * drives (command palette + shortcuts sheet).
 *
 * The decision itself is pure (`lib/hotkeys/globalHotkeys.ts`, unit-tested);
 * this component only wires it to the stores. The listener is registered in
 * the CAPTURE phase: a consumed chord must be stopped before it reaches the
 * screens' own window `keydown` listeners (bubble phase), otherwise e.g.
 * `g d` would navigate AND the Results screen would treat the same `d` as
 * its micro-drill launch. Per §4.1.4 the listener bails out when an editable
 * field owns the keystrokes — the palette's own input is exactly how that
 * guard stands down while the palette is open — and releases stray chrome
 * focus before acting.
 */
export function GlobalHotkeys() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Element the palette chord fired on — restored on palette close. */
  const [paletteOpener, setPaletteOpener] = useState<HTMLElement | null>(null);
  /** Pending first half of a vim chord (`g …`), armed by the pure keymap. */
  const gArmedAt = useRef(0);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const decision = globalHotkeyDecision(
        event,
        {
          editableFocused: isEditableFocused(),
          // `running` covers both a lesson run and a weakness set.
          sessionRunning: useSessionStore.getState().phase === "running",
          paletteOpen,
          shortcutsOpen,
        },
        { gArmedAt: gArmedAt.current, now: Date.now() },
      );
      gArmedAt.current = decision.gArmedAt;
      const action: GlobalHotkeyAction | null = decision.action;
      // `action === null` = "leave the key alone": full propagation, the
      // screen handlers downstream must still see it.
      if (action === null) return;
      if (decision.consume) {
        // Capture phase + immediate stop: also silence every listener that
        // has not run yet (other window listeners in either phase, React's
        // root-container handlers), so one chord can never act twice.
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      // Capture the opener BEFORE `releaseChromeFocus` blurs a focused
      // button — otherwise the palette would read <body> and skip its
      // focus-restore on close.
      const opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      releaseChromeFocus();

      if (action.kind === "toggle-palette") {
        setShortcutsOpen(false);
        setPaletteOpener(opener);
        setPaletteOpen((open) => !open);
      } else if (action.kind === "open-palette") {
        setShortcutsOpen(false);
        setPaletteOpener(opener);
        setPaletteOpen(true);
      } else if (action.kind === "open-shortcuts") {
        setPaletteOpen(false);
        setShortcutsOpen(true);
      } else if (action.kind === "close-shortcuts") {
        setShortcutsOpen(false);
      } else {
        setPaletteOpen(false);
        setShortcutsOpen(false);
        useUiStore.getState().navigate(action.screen);
      }
    };
    // CAPTURE phase — see the class doc: a consumed chord must die before it
    // bubbles into the session/results screens' own window listeners.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [paletteOpen, shortcutsOpen]);

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={closePalette} opener={paletteOpener} />
      <ShortcutsModal open={shortcutsOpen} onClose={closeShortcuts} />
    </>
  );
}
