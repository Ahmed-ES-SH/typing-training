/**
 * Focus Shield (UX plan §4.1.4) — the rule shared by the session and results
 * key listeners: keystrokes belong to the buffer, never to chrome a stray
 * click left focused. Extracted so both screens express the rule once
 * instead of drifting apart.
 */

/**
 * Input types that are NOT text fields — a focused slider/checkbox/… must
 * not swallow global keys (`/`, `?`, `g …`, `Alt+1..6`) the way a real
 * text field legitimately does. Everything else (`text`, `search`, `email`,
 * `number`, `date`, … and the implicit default `text`) is text-like.
 */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** True when the focused element is an editable field that owns keystrokes. */
export function isEditableFocused(): boolean {
  return isEditableElement(document.activeElement);
}

/**
 * Pure predicate behind {@link isEditableFocused} — `element` is duck-typed
 * (tag/`type`/`isContentEditable`) instead of `instanceof`-checked so it can
 * be unit-tested in the node vitest environment without a DOM.
 *
 * True for: `<textarea>`, text-like `<input>`s, contenteditable subtrees and
 * `<select>` (Space/Enter navigate a focused select — hijacking them as
 * screen shortcuts breaks it). False for buttons/checkboxes/… and anything
 * else (body, links, null).
 */
export function isEditableElement(element: unknown): boolean {
  if (typeof element !== "object" || element === null) return false;
  const el = element as { tagName?: unknown; isContentEditable?: unknown; type?: unknown };
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  // `isContentEditable` is true for descendants too (the browser computes it
  // for the whole subtree), so a nested editable region is covered here.
  if (tag === "TEXTAREA" || el.isContentEditable === true || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  // `<input>` without a type attribute defaults to type="text".
  const type = typeof el.type === "string" && el.type !== "" ? el.type.toLowerCase() : "text";
  return !NON_TEXT_INPUT_TYPES.has(type);
}

/** Releases a button/link a stray click left focused so it cannot swallow
 * Space/Enter before the screen's own shortcut handler sees them. */
export function releaseChromeFocus(): void {
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== document.body &&
    (active.tagName === "BUTTON" || active.tagName === "A")
  ) {
    active.blur();
  }
}
