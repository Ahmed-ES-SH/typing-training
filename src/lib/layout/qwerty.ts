import type { Finger, KeyboardLayout, KeyDef } from "./keymap";

/** QWERTY US ANSI — the initial layout target (PRD §19). Includes every
 * §6.1 programming symbol via shift pairs: ( ) { } [ ] < > / \ | & * = + -
 * _ : ; ' " ` ! ? @ # $ %. */

const char = (
  id: string,
  base: string,
  shift: string | undefined,
  finger: Finger,
  width?: number,
): KeyDef => ({ id, base, shift, finger, width, kind: "char" });

const special = (
  id: string,
  finger: Finger,
  width: number,
  label: string,
): KeyDef => ({ id, base: "", finger, width, kind: "special", label });

export const QWERTY_US: KeyboardLayout = {
  id: "qwerty-us",
  name: "QWERTY (US ANSI)",
  rows: [
    [
      char("backtick", "`", "~", "pinky-l"),
      char("digit-1", "1", "!", "pinky-l"),
      char("digit-2", "2", "@", "ring-l"),
      char("digit-3", "3", "#", "middle-l"),
      char("digit-4", "4", "$", "index-l"),
      char("digit-5", "5", "%", "index-l"),
      char("digit-6", "6", "^", "index-r"),
      char("digit-7", "7", "&", "index-r"),
      char("digit-8", "8", "*", "middle-r"),
      char("digit-9", "9", "(", "ring-r"),
      char("digit-0", "0", ")", "pinky-r"),
      char("minus", "-", "_", "pinky-r"),
      char("equal", "=", "+", "pinky-r"),
      special("backspace", "pinky-r", 2, "BKSP"),
    ],
    [
      special("tab", "pinky-l", 1.5, "TAB"),
      char("q", "q", "Q", "pinky-l"),
      char("w", "w", "W", "ring-l"),
      char("e", "e", "E", "middle-l"),
      char("r", "r", "R", "index-l"),
      char("t", "t", "T", "index-l"),
      char("y", "y", "Y", "index-r"),
      char("u", "u", "U", "index-r"),
      char("i", "i", "I", "middle-r"),
      char("o", "o", "O", "ring-r"),
      char("p", "p", "P", "pinky-r"),
      char("bracket-l", "[", "{", "pinky-r"),
      char("bracket-r", "]", "}", "pinky-r"),
      char("backslash", "\\", "|", "pinky-r", 1.5),
    ],
    [
      special("caps-lock", "pinky-l", 1.75, "CAPS"),
      char("a", "a", "A", "pinky-l"),
      char("s", "s", "S", "ring-l"),
      char("d", "d", "D", "middle-l"),
      char("f", "f", "F", "index-l"),
      char("g", "g", "G", "index-l"),
      char("h", "h", "H", "index-r"),
      char("j", "j", "J", "index-r"),
      char("k", "k", "K", "middle-r"),
      char("l", "l", "L", "ring-r"),
      char("semicolon", ";", ":", "pinky-r"),
      char("apostrophe", "'", '"', "pinky-r"),
      special("enter", "pinky-r", 2.25, "ENTER"),
    ],
    [
      special("shift-l", "pinky-l", 2.25, "SHIFT"),
      char("z", "z", "Z", "pinky-l"),
      char("x", "x", "X", "ring-l"),
      char("c", "c", "C", "middle-l"),
      char("v", "v", "V", "index-l"),
      char("b", "b", "B", "index-l"),
      char("n", "n", "N", "index-r"),
      char("m", "m", "M", "index-r"),
      char("comma", ",", "<", "index-r"),
      char("period", ".", ">", "middle-r"),
      char("slash", "/", "?", "ring-r"),
      special("shift-r", "pinky-r", 2.75, "SHIFT"),
    ],
    [
      special("ctrl-l", "pinky-l", 1.25, "CTRL"),
      special("meta-l", "thumb", 1.25, "OPT"),
      special("alt-l", "thumb", 1.25, "CMD"),
      char("space", " ", undefined, "thumb", 6.25),
      special("alt-r", "thumb", 1.25, "CMD"),
      special("meta-r", "thumb", 1.25, "OPT"),
      special("ctrl-r", "pinky-r", 1.25, "CTRL"),
    ],
  ],
};
