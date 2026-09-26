/**
 * Global hotkey map + command-palette matcher (UX plan §5.1–5.2, keybinding
 * matrix §10) — the pure decision core behind `GlobalHotkeys` and
 * `CommandPalette`. Kept free of DOM/state/zustand so every guard ("never
 * mid-typing-session", "never inside an input", "the `g` chord expires") is
 * asserted by unit tests instead of vibes — same split as
 * `lib/session/goldenLoop.ts`.
 */

import type { ScreenId } from "../screens";
import type { KeyLike } from "../session/goldenLoop";

/* ---------------------------------------------------------------------------
 * Bindings (verbatim from UX plan §5.2 / §10)
 * ------------------------------------------------------------------------- */

/** `Alt+1..6` → the six directly-navigable screens (typing-session and
 * lesson-results are contextual and never hot-linked). */
export const ALT_SCREEN_HOTKEYS: Readonly<Record<string, ScreenId>> = {
  "1": "dashboard",
  "2": "lessons",
  "3": "weakness-training",
  "4": "custom-lessons",
  "5": "statistics",
  "6": "settings",
};

/** Second half of each vim chord: `g` + key → screen (§5.2.2). */
export const G_CHORD_HOTKEYS: Readonly<Record<string, ScreenId>> = {
  d: "dashboard",
  l: "lessons",
  w: "weakness-training",
  s: "statistics",
  c: "custom-lessons",
  ",": "settings",
};

/** How long a pressed `g` stays armed for its second half (§5.2.2). */
export const G_CHORD_WINDOW_MS = 1000;

/* ---------------------------------------------------------------------------
 * Decision API
 * ------------------------------------------------------------------------- */

export type GlobalHotkeyAction =
  | { kind: "toggle-palette" }
  | { kind: "open-palette" }
  | { kind: "open-shortcuts" }
  | { kind: "close-shortcuts" }
  | { kind: "navigate"; screen: ScreenId };

/** Snapshot of the guards every binding must respect. */
export interface GlobalHotkeyContext {
  /** Focus shield (§4.1.4): an input/search field owns its keystrokes. */
  editableFocused: boolean;
  /** A typing session (or weakness set) is actively running. */
  sessionRunning: boolean;
  /** The command palette is already open. */
  paletteOpen: boolean;
  /** The shortcuts sheet is already open. */
  shortcutsOpen: boolean;
}

export interface GlobalHotkeyState {
  /** Epoch ms of the pending `g` press; 0 = no chord armed. */
  gArmedAt: number;
  /** Caller-supplied clock (`Date.now()`) — tests control time. */
  now: number;
}

export interface GlobalHotkeyDecision {
  action: GlobalHotkeyAction | null;
  /** True when the caller must `preventDefault()` the event. */
  consume: boolean;
  /** Pending-`g` timestamp to carry into the next evaluation. */
  gArmedAt: number;
}

function noAction(): GlobalHotkeyDecision {
  return { action: null, consume: false, gArmedAt: 0 };
}

function navigateTo(screen: ScreenId): GlobalHotkeyDecision {
  return { action: { kind: "navigate", screen }, consume: true, gArmedAt: 0 };
}

/** `undefined` = "this phase has no opinion"; the next phase decides. */
type PhaseDecision = GlobalHotkeyDecision | undefined;

/** Ctrl/Cmd+K wins everywhere; every other modifier chord is the OS's. */
function modifiedChordDecision(event: KeyLike): PhaseDecision {
  const modified = event.ctrlKey === true || event.metaKey === true;
  if (!modified) return undefined;
  if (event.altKey !== true && event.key.toLowerCase() === "k") {
    return { action: { kind: "toggle-palette" }, consume: true, gArmedAt: 0 };
  }
  return noAction();
}

/** `Alt+1..6` screen switch — §10 Global scope, so a run may be left mid-typing. */
function altScreenDecision(
  event: KeyLike,
  ctx: GlobalHotkeyContext,
): PhaseDecision {
  if (event.altKey !== true) return undefined;
  if (ctx.editableFocused) return noAction();
  const screen = ALT_SCREEN_HOTKEYS[event.key];
  return screen === undefined ? noAction() : navigateTo(screen);
}

/** `/` → palette, `?` → cheat sheet; both dead while a session runs.
 * `?` toggles: the sheet's footer promises "`?` or `Esc` to close", so with
 * the sheet already up the same key must dismiss it instead of no-oping. */
function overlayDecision(
  event: KeyLike,
  ctx: GlobalHotkeyContext,
): PhaseDecision {
  const key = event.key;
  if (key !== "/" && key !== "?") return undefined;
  // Mid-run these are ordinary lesson input, never a navigation key (§5.2.2).
  if (ctx.sessionRunning) return noAction();
  if (key === "/") {
    return ctx.paletteOpen
      ? noAction()
      : { action: { kind: "open-palette" }, consume: true, gArmedAt: 0 };
  }
  const action: GlobalHotkeyAction = ctx.shortcutsOpen
    ? { kind: "close-shortcuts" }
    : { kind: "open-shortcuts" };
  return { action, consume: true, gArmedAt: 0 };
}

/** `g` + key chords: `g` arms a ~1s window; any other key clears it. */
function vimChordDecision(
  event: KeyLike,
  ctx: GlobalHotkeyContext,
  state: GlobalHotkeyState,
): GlobalHotkeyDecision {
  if (ctx.sessionRunning) return noAction();
  if (event.key === "g") {
    // Re-arming on a second `g` restarts the window (`g g` maps nowhere).
    return { action: null, consume: false, gArmedAt: state.now };
  }
  const armed =
    state.gArmedAt > 0 &&
    state.now - state.gArmedAt >= 0 &&
    state.now - state.gArmedAt <= G_CHORD_WINDOW_MS;
  const screen = armed ? G_CHORD_HOTKEYS[event.key] : undefined;
  return screen !== undefined ? navigateTo(screen) : noAction();
}

/**
 * Resolves one keydown into the §5.2 binding (`action: null` = leave the key
 * alone). Precedence: `Ctrl/Cmd+K` → `Alt+1..6` → focus shield → `/`/`?` →
 * vim chords — the palette chord is the only one that survives an editable
 * focus or a running session, because it must be reachable while typing.
 */
export function globalHotkeyDecision(
  event: KeyLike,
  ctx: GlobalHotkeyContext,
  state: GlobalHotkeyState,
): GlobalHotkeyDecision {
  const chord = modifiedChordDecision(event);
  if (chord !== undefined) return chord;

  const altScreen = altScreenDecision(event, ctx);
  if (altScreen !== undefined) return altScreen;

  // Focus shield (§4.1.4): an input owns every keystroke below this line —
  // including any half-typed `g`.
  if (ctx.editableFocused) return noAction();

  const overlay = overlayDecision(event, ctx);
  if (overlay !== undefined) return overlay;

  return vimChordDecision(event, ctx, state);
}

/* ---------------------------------------------------------------------------
 * Command palette matching (§5.1 "fuzzy search")
 * ------------------------------------------------------------------------- */

/** Weighted, pre-assembled text of one palette entry. */
export interface PaletteDoc {
  /** Primary text: lesson title, screen label or action label. */
  title: string;
  /** Secondary terms: module ids/codes, tags, target keys, group labels. */
  keywords: readonly string[];
}

/**
 * Score of `query` against `doc`, or `null` when the entry does not match.
 *
 * Every whitespace-separated token must land in the title or a keyword
 * (AND semantics); title hits outweigh keyword hits so "Regex" ranks a
 * Regex lesson above a lesson merely tagged with the word. An empty query
 * matches everything with score 0, preserving the caller's entry order.
 */
export function paletteScore(query: string, doc: PaletteDoc): number | null {
  const q = query.trim().toLowerCase();
  if (q === "") return 0;

  const title = doc.title.toLowerCase();
  let score = 0;
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 60;
  else if (title.includes(q)) score += 40;

  const keywords = doc.keywords.map((keyword) => keyword.toLowerCase());
  for (const token of q.split(/\s+/)) {
    if (title.includes(token)) {
      score += 12;
      continue;
    }
    const keyword = keywords.find((candidate) => candidate.includes(token));
    if (keyword === undefined) return null;
    score += keyword === token ? 6 : 3;
  }
  return score;
}

/**
 * Filters `entries` by `paletteScore` and ranks them best-first; ties keep
 * the original order (stable), so the untouched empty query renders exactly
 * what the caller assembled.
 */
export function rankPalette<T>(
  query: string,
  entries: readonly T[],
  docOf: (entry: T) => PaletteDoc,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: paletteScore(query, docOf(entry)) }))
    .filter((row): row is { entry: T; index: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.entry);
}
