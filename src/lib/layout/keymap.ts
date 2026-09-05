/**
 * Layout-agnostic keyboard abstraction (PRD §19).
 *
 * The typing engine, the session screen and the keyboard visualization
 * consume ONLY this module — no file outside `src/lib/layout/` may assume a
 * specific physical mapping. Adding a layout (Dvorak, Colemak, ...) means
 * adding one new `KeyboardLayout` instance, nothing else.
 */

export type Finger =
  | "pinky-l"
  | "ring-l"
  | "middle-l"
  | "index-l"
  | "thumb"
  | "index-r"
  | "middle-r"
  | "ring-r"
  | "pinky-r";

/** One physical key. Char keys produce `base` (or `shift` with Shift held);
 * special keys (Tab/Enter/Shift/...) carry a `label` instead. */
export interface KeyDef {
  id: string;
  /** Unshifted character, or "" for special keys. */
  base: string;
  /** Shifted character, when the key produces one. */
  shift?: string;
  finger: Finger;
  /** Relative width in key units (default 1). */
  width?: number;
  kind?: "char" | "special";
  /** Caption for special keys (e.g. "ENTER"). */
  label?: string;
}

export interface KeyboardLayout {
  id: string;
  name: string;
  rows: KeyDef[][];
}

export interface KeyTarget {
  key: KeyDef;
  requiresShift: boolean;
}

/** Which physical key produces `char` on this layout (null if unmapped). */
export function findKey(layout: KeyboardLayout, char: string): KeyTarget | null {
  for (const row of layout.rows) {
    for (const key of row) {
      if (key.kind === "special") continue;
      if (key.base === char) return { key, requiresShift: false };
      if (key.shift !== undefined && key.shift === char) {
        return { key, requiresShift: true };
      }
    }
  }
  return null;
}

/** Resolves the key to highlight for the next expected char, including the
 * Enter key for newlines ("`char` -> physical key" is the layout's job). */
export function findTargetKey(
  layout: KeyboardLayout,
  char: string,
): KeyTarget | null {
  if (char === "\n") {
    for (const row of layout.rows) {
      for (const key of row) {
        if (key.kind === "special" && key.id === "enter") {
          return { key, requiresShift: false };
        }
      }
    }
    return null;
  }
  return findKey(layout, char);
}
