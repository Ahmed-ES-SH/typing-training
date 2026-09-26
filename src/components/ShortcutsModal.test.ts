import { describe, expect, it } from "vitest";

import {
  ALT_SCREEN_HOTKEYS,
  G_CHORD_HOTKEYS,
} from "../lib/hotkeys/globalHotkeys";
import { SECTIONS } from "./ShortcutsModal";

/**
 * `SECTIONS` is a hand-maintained copy of the §10 keymap (the real chord
 * constants live in `lib/hotkeys/globalHotkeys.ts`, which this test only
 * reads). These assertions are the drift net: whenever the keymap adds,
 * drops or renames a chord, the sheet must be updated in the same commit.
 */

const CHORDS = SECTIONS.flatMap((section) =>
  section.rows.flatMap((row) => row.chords),
);

describe("ShortcutsModal chord matrix vs globalHotkeys keymap", () => {
  it("documents exactly the Alt screen-switch range", () => {
    const altKeys = Object.keys(ALT_SCREEN_HOTKEYS);
    const documented = CHORDS.filter((chord) => chord.includes("Alt+"));
    // The sheet renders one range badge ("Alt+1 … Alt+6") for the whole map.
    expect(documented).toEqual([
      `Alt+${altKeys[0]} … Alt+${altKeys[altKeys.length - 1]}`,
    ]);
    // A range shorthand only stays honest while the keys are contiguous —
    // a new/dropped Alt binding must break this test, not the docs silently.
    expect(altKeys).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("documents every vim g-chord and no phantom ones", () => {
    const expected = Object.keys(G_CHORD_HOTKEYS).map((key) => `g ${key}`);
    const documented = CHORDS.filter((chord) => chord.startsWith("g "));
    expect([...documented].sort()).toEqual([...expected].sort());
  });

  it("keeps the palette and cheat-sheet chords documented", () => {
    expect(CHORDS).toEqual(
      expect.arrayContaining(["Ctrl+K", "Cmd+K", "/", "?"]),
    );
  });
});
