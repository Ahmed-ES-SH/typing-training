/**
 * Custom lesson auto-detabifier (UX plan §6.1).
 *
 * Tab characters are illegal in lesson content — `CustomLessonSchema`
 * refines `!content.includes("\t")` and that rule is §8 product law. This
 * helper converts pasted (or otherwise injected) tabs into plain spaces
 * BEFORE validation ever sees them, so the editor can never produce the
 * "tabs are not supported" issue while the schema stays untouched.
 *
 * Deliberately a simple substitution (every `\t` becomes exactly `tabSize`
 * spaces), not tab-stop alignment: the result must be deterministic for the
 * typist regardless of column position.
 */

/** Space width applied to each tab character (Settings → Appearance). */
export type TabSize = 2 | 4;

export function detabify(
  text: string,
  tabSize: TabSize,
): { text: string; tabsConverted: number } {
  const tabsConverted = text.split("\t").length - 1;
  if (tabsConverted === 0) return { text, tabsConverted: 0 };
  return { text: text.split("\t").join(" ".repeat(tabSize)), tabsConverted };
}
