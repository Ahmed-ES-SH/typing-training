/**
 * Golden Loop keymap (UX plan §4.1 + Phase 4 §7.1/§7.3) — the pure decision
 * core behind the Results screen's "Smart Enter" and its 1-click Micro-Drill
 * (`D`), the session's instant-reset chord, the Zen Mode toggle and the
 * in-session heatmap glance (`H`). Kept free of DOM/state so the verification
 * gate ("Enter never dead-ends") is asserted by unit tests instead of vibes.
 */

/** What a Results-screen key press should do. `null` = ignore the key. */
export type ResultsAction =
  | "next-lesson"
  | "retry-lesson"
  | "curriculum"
  /** §7.1 — launch the 45 s targeted Micro-Drill on the missed keys. */
  | "drill-micro";

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export interface ResultsKeyContext {
  /** There is a next curriculum lesson to advance into. */
  canAdvance: boolean;
  /**
   * An attempt payload is loaded — until it is, Enter/Space/D have nothing
   * to act on and resolve to `null`. Ctrl+R is NOT gated on this flag: it
   * is always claimed as "retry" so the browser can never reload the page
   * out from under the Results screen (even while the payload is loading).
   */
  hasAttempt: boolean;
  /**
   * §7.1 — the attempt has missed keys worth drilling (the Results screen
   * only offers `D` when a Targeted Micro-Drill card is on screen).
   */
  canDrill?: boolean;
}

/**
 * §4.1.1 "Smart Enter": Enter ALWAYS resolves to the smartest next step —
 * advance on PASS (when unlocked), instant retry on FAIL. Space replays the
 * current lesson for a personal best; Esc returns to the curriculum.
 * §7.1 adds bare `D` as the 1-click Micro-Drill launch (only when the
 * attempt actually has drillable missed keys).
 * Alt/Meta combos and plain Ctrl combos belong to the OS / shell, so they
 * resolve to `null` (only Ctrl+R is claimed, as "retry").
 */
export function resultsActionFor(
  event: KeyLike,
  ctx: ResultsKeyContext,
): ResultsAction | null {
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;

  // Alt/Meta combos fall through to the `alt || meta` guard below — an
  // Alt+Escape is the OS/window-manager's chord, never "back to curriculum".
  if (event.key === "Escape" && !ctrl && !meta && !alt) return "curriculum";
  if (alt || meta) return null;
  if (ctrl) return event.key.toLowerCase() === "r" ? "retry-lesson" : null;

  if (!ctx.hasAttempt) return null;
  if (event.key === "Enter") return ctx.canAdvance ? "next-lesson" : "retry-lesson";
  // Space: replay for a PR on PASS, instant retry on FAIL — same gesture.
  if (event.key === " ") return "retry-lesson";
  // §7.1: bare D (Shift is not a modifier here — "D" is the same physical
  // key) launches the micro-drill when the card is offered; Ctrl/Alt/Meta
  // combos already returned above, so they never reach this branch.
  if ((event.key === "d" || event.key === "D") && ctx.canDrill === true) {
    return "drill-micro";
  }
  return null;
}

/** How long after a Tab press the Enter half of the reset chord still counts. */
export const TAB_RESET_WINDOW_MS = 1500;

/**
 * §4.1.2 — `Tab + Enter` restarts the buffer. Tab itself still types a space
 * (content never contains tabs), and arms the chord; Enter within the window
 * consumes it and restarts instead of committing a newline.
 */
export function isTabResetChord(
  event: KeyLike,
  tabArmedAt: number,
  now: number,
): boolean {
  if (event.key !== "Enter") return false;
  if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) {
    return false;
  }
  return (
    tabArmedAt > 0 &&
    now - tabArmedAt >= 0 &&
    now - tabArmedAt <= TAB_RESET_WINDOW_MS
  );
}

/** True when the press claims Ctrl+R as the instant, dialog-free reset. */
export function isInstantReset(event: KeyLike): boolean {
  return (
    (event.ctrlKey === true || event.metaKey === true) &&
    event.altKey !== true &&
    event.key.toLowerCase() === "r"
  );
}

/**
 * §4.1.3 — Zen / Focus Mode toggle. `Ctrl+Shift+F` (or Cmd+Shift+F) is the
 * chord available mid-run; the bare `F` is only honoured while the session is
 * NOT actively typing, because `f` is an ordinary lesson character.
 */
export function isZenToggle(event: KeyLike, sessionRunning: boolean): boolean {
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;
  const isF = event.key === "f" || event.key === "F";

  if (alt || !isF) return false;
  if (ctrl || meta) return shift;
  return !shift && !sessionRunning;
}

/**
 * §7.3 "Heatmap Glance" — the exact `isZenToggle` precedent applied to `H`:
 * `Ctrl+Shift+H` (or Cmd+Shift+H) is the chord available mid-run; the bare
 * `H` is only honoured while the session is NOT actively typing, because
 * `h` is an ordinary lesson character (same reason bare `F` is chord-only —
 * binding it mid-run would eat a legitimate keystroke). Plain `Ctrl+H`
 * stays the shell's chord.
 */
export function isHeatmapToggle(event: KeyLike, sessionRunning: boolean): boolean {
  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;
  const isH = event.key === "h" || event.key === "H";

  if (alt || !isH) return false;
  if (ctrl || meta) return shift;
  return !shift && !sessionRunning;
}
