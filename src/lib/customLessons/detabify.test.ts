import { describe, expect, it } from "vitest";

import { detabify } from "./detabify";

/**
 * §6.1 detabifier: pure tab → space substitution feeding the Custom Lessons
 * paste path. The count is the number of TAB CHARACTERS replaced (the
 * design's "Converted 14 tabs to spaces" badge), and non-tab content —
 * including newlines and astral-plane unicode — must come back untouched.
 */

describe("detabify", () => {
  it("passes an empty string through with zero conversions", () => {
    expect(detabify("", 2)).toEqual({ text: "", tabsConverted: 0 });
    expect(detabify("", 4)).toEqual({ text: "", tabsConverted: 0 });
  });

  it("returns tab-free text identically (same reference) and counts 0", () => {
    const source = "const x = { a: 1 };\nreturn x;";
    const result = detabify(source, 4);
    expect(result.text).toBe(source);
    expect(result.tabsConverted).toBe(0);
  });

  it("replaces every tab with exactly tabSize spaces", () => {
    expect(detabify("\t", 2).text).toBe("  ");
    expect(detabify("\t", 4).text).toBe("    ");
    expect(detabify("a\tb", 2)).toEqual({ text: "a  b", tabsConverted: 1 });
    expect(detabify("a\tb", 4)).toEqual({ text: "a    b", tabsConverted: 1 });
  });

  it("keeps newlines intact while converting mixed tab content", () => {
    expect(detabify("fn() {\n\tbody();\n\tif (x) {\n\t\ty();\n\t}\n}", 2)).toEqual({
      text: "fn() {\n  body();\n  if (x) {\n    y();\n  }\n}",
      tabsConverted: 5,
    });
  });

  it("counts tab characters, not lines or replacement spaces", () => {
    const source = "\t\t\tone tab each";
    expect(detabify(source, 4)).toEqual({
      text: "    ".repeat(3).concat("one tab each"),
      tabsConverted: 3,
    });
    // Two tabs on one line, one on another — 3 tabs, 3 replacements.
    expect(detabify("a\tb\tc\n\td", 2).tabsConverted).toBe(3);
    expect(detabify("a\tb\tc\n\td", 2).text).toBe("a  b  c\n  d");
  });

  it("only ever rewrites \\t (unicode stays byte-identical)", () => {
    const source = "café → 中文 🚀\tconst emoji = \"🦀\";";
    const result = detabify(source, 4);
    expect(result.tabsConverted).toBe(1);
    expect(result.text).toBe(
      "café → 中文 🚀    const emoji = \"🦀\";",
    );
    expect(result.text).not.toContain("\t");
  });
});
