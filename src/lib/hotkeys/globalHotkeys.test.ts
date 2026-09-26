import { describe, expect, it } from "vitest";

import {
  ALT_SCREEN_HOTKEYS,
  G_CHORD_HOTKEYS,
  G_CHORD_WINDOW_MS,
  globalHotkeyDecision,
  paletteScore,
  rankPalette,
  type GlobalHotkeyContext,
  type PaletteDoc,
} from "./globalHotkeys";

const idle: GlobalHotkeyContext = {
  editableFocused: false,
  sessionRunning: false,
  paletteOpen: false,
  shortcutsOpen: false,
};

/** Evaluates one press with an optional pre-armed `g` at `armedAt`. */
function press(
  event: Parameters<typeof globalHotkeyDecision>[0],
  ctx: Partial<GlobalHotkeyContext> = {},
  armedAt = 0,
  now = 10_000,
) {
  return globalHotkeyDecision(event, { ...idle, ...ctx }, { gArmedAt: armedAt, now });
}

describe("globalHotkeyDecision — Ctrl/Cmd+K (§10 Global)", () => {
  it("toggles the palette from anywhere, even mid-session or in an input", () => {
    for (const ctx of [
      idle,
      { sessionRunning: true },
      { editableFocused: true },
      { paletteOpen: true },
    ] as GlobalHotkeyContext[]) {
      const decision = press({ key: "k", ctrlKey: true }, ctx);
      expect(decision.action).toEqual({ kind: "toggle-palette" });
      expect(decision.consume).toBe(true);
    }
    expect(press({ key: "K", metaKey: true }).action).toEqual({ kind: "toggle-palette" });
  });

  it("leaves other Ctrl/Cmd chords to the OS and disarms a pending g", () => {
    expect(press({ key: "r", ctrlKey: true }, {}, 9_000).action).toBeNull();
    expect(press({ key: "r", ctrlKey: true }, {}, 9_000).gArmedAt).toBe(0);
    // Ctrl+Alt+K is not the palette chord.
    expect(press({ key: "k", ctrlKey: true, altKey: true }).action).toBeNull();
  });
});

describe("globalHotkeyDecision — Alt+1..6 (§5.2.2)", () => {
  it("switches to the six navigable screens", () => {
    expect(press({ key: "1", altKey: true }).action).toEqual({
      kind: "navigate",
      screen: "dashboard",
    });
    expect(press({ key: "4", altKey: true }).action).toEqual({
      kind: "navigate",
      screen: "custom-lessons",
    });
    expect(press({ key: "6", altKey: true }).action).toEqual({
      kind: "navigate",
      screen: "settings",
    });
    expect(press({ key: "6", altKey: true }).consume).toBe(true);
  });

  it("never fires while an editable field owns the keystrokes", () => {
    expect(press({ key: "1", altKey: true }, { editableFocused: true }).action).toBeNull();
  });

  it("ignores unmapped digits and non-Alt combos", () => {
    expect(press({ key: "0", altKey: true }).action).toBeNull();
    expect(press({ key: "1" }).action).toBeNull();
    expect(press({ key: "1", altKey: true, ctrlKey: true }).action).toBeNull();
    expect(Object.keys(ALT_SCREEN_HOTKEYS)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});

describe("globalHotkeyDecision — / and ? (§5.2.2)", () => {
  it("opens the palette / cheat sheet only outside a running session", () => {
    expect(press({ key: "/" }).action).toEqual({ kind: "open-palette" });
    expect(press({ key: "?" }).action).toEqual({ kind: "open-shortcuts" });
    expect(press({ key: "/" }, { sessionRunning: true }).action).toBeNull();
    expect(press({ key: "?" }, { sessionRunning: true }).action).toBeNull();
  });

  it("respects the focus shield and the already-open overlays", () => {
    expect(press({ key: "/" }, { editableFocused: true }).action).toBeNull();
    expect(press({ key: "/" }, { paletteOpen: true }).action).toBeNull();
    // The sheet's footer promises "`?` or `Esc` to close" — so `?` toggles
    // it shut instead of no-op'ing.
    expect(press({ key: "?" }, { shortcutsOpen: true }).action).toEqual({
      kind: "close-shortcuts",
    });
    expect(press({ key: "?" }, { shortcutsOpen: true }).consume).toBe(true);
    // Everything else (including the armed chord) is dead in an input.
    expect(press({ key: "d" }, { editableFocused: true }, 9_999).action).toBeNull();
    expect(press({ key: "d" }, { editableFocused: true }, 9_999).gArmedAt).toBe(0);
  });

  it("consumes / so the browser quick-find never steals it", () => {
    expect(press({ key: "/" }).consume).toBe(true);
  });
});

describe("globalHotkeyDecision — vim chords (§5.2.2)", () => {
  const armed = 9_500; // now = 10_000 → 500 ms old, inside the window

  it("maps every second key of the §10 matrix", () => {
    const expected: Record<string, string> = {
      d: "dashboard",
      l: "lessons",
      w: "weakness-training",
      s: "statistics",
      c: "custom-lessons",
      ",": "settings",
    };
    expect(G_CHORD_HOTKEYS).toEqual(expected);
    for (const [key, screen] of Object.entries(expected)) {
      expect(press({ key }, {}, armed).action).toEqual({ kind: "navigate", screen });
    }
  });

  it("arms on g without consuming it", () => {
    const decision = press({ key: "g" }, {}, 0, 10_000);
    expect(decision.action).toBeNull();
    expect(decision.consume).toBe(false);
    expect(decision.gArmedAt).toBe(10_000);
  });

  it("fires only inside the ~1s window", () => {
    const expired = 10_000 - G_CHORD_WINDOW_MS - 1;
    expect(press({ key: "d" }, {}, expired).action).toBeNull();
    expect(press({ key: "d" }, {}, expired).gArmedAt).toBe(0);
    expect(press({ key: "d" }, {}, 10_000 - G_CHORD_WINDOW_MS).action).toEqual({
      kind: "navigate",
      screen: "dashboard",
    });
  });

  it("resets on any other key, modifier or running session", () => {
    expect(press({ key: "x" }, {}, armed).gArmedAt).toBe(0);
    expect(press({ key: "X", shiftKey: true }, {}, armed).gArmedAt).toBe(0);
    // Shift+d arrives as key "D" — an unshifted g chord only, like Vim's.
    expect(press({ key: "D", shiftKey: true }, {}, armed).action).toBeNull();
    expect(press({ key: "D", shiftKey: true }, {}, armed).gArmedAt).toBe(0);
    expect(press({ key: "d", altKey: true }, {}, armed).action).toBeNull();
    expect(press({ key: "d" }, { sessionRunning: true }, armed).action).toBeNull();
    expect(press({ key: "d" }, { sessionRunning: true }, armed).gArmedAt).toBe(0);
    // An expired arm still resets cleanly instead of firing.
    expect(press({ key: "d" }, {}, 0).action).toBeNull();
  });
});

/* ------------------------- palette matching (§5.1) ------------------------- */

const lesson: PaletteDoc = {
  title: "Regex & Character Classes",
  keywords: ["l3-014", "3.14", "level 3", "symbols", "regex"],
};
const action: PaletteDoc = {
  title: "Switch Theme",
  keywords: ["action", "theme", "terminal-mono"],
};

describe("paletteScore (§5.1 fuzzy search)", () => {
  it("matches everything on an empty query, in caller order", () => {
    expect(paletteScore("", lesson)).toBe(0);
    expect(paletteScore("   ", lesson)).toBe(0);
  });

  it("matches title substrings case-insensitively", () => {
    expect(paletteScore("regex", lesson)).not.toBeNull();
    expect(paletteScore("CHARACTER", lesson)).not.toBeNull();
    expect(paletteScore("l3-014", lesson)).not.toBeNull();
    expect(paletteScore("L3-014", lesson)).not.toBeNull();
    expect(paletteScore("3.14", lesson)).not.toBeNull();
    expect(paletteScore("=>", { title: "Arrow functions", keywords: ["=>"] })).not.toBeNull();
  });

  it("requires EVERY token to land (AND semantics)", () => {
    expect(paletteScore("regex mix", lesson)).toBeNull();
    expect(paletteScore("regex level", lesson)).not.toBeNull();
    expect(paletteScore("nope", lesson)).toBeNull();
  });

  it("ranks title hits above keyword hits", () => {
    // "regex" is IN the lesson title; "action" is only one of its keywords.
    const titleHit = paletteScore("regex", lesson);
    const keywordOnly = paletteScore("action", action);
    expect(titleHit).not.toBeNull();
    expect(keywordOnly).not.toBeNull();
    expect(titleHit as number).toBeGreaterThan(keywordOnly as number);
  });
});

describe("rankPalette (§5.1 ordering)", () => {
  const entries = [
    { doc: action },
    { doc: { title: "Export Backup JSON", keywords: ["action", "backup"] } },
    { doc: lesson },
    { doc: { title: "Dashboard", keywords: ["screen", "alt+1"] } },
  ];

  it("keeps the given order for an empty query", () => {
    expect(rankPalette("", entries, (entry) => entry.doc)).toEqual(entries);
  });

  it("returns matches best-first and drops non-matches", () => {
    const ranked = rankPalette("regex", entries, (entry) => entry.doc);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toEqual({ doc: lesson });
  });

  it("is stable for ties", () => {
    const tied = [
      { doc: { title: "backup one", keywords: [] } },
      { doc: { title: "backup two", keywords: [] } },
    ];
    expect(rankPalette("backup", tied, (entry) => entry.doc)).toEqual(tied);
  });
});
