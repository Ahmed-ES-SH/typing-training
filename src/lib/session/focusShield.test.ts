import { describe, expect, it } from "vitest";

import { isEditableElement } from "./focusShield";

/**
 * Focus Shield (UX plan §4.1.4) — the pure element predicate. Vitest runs in
 * the node environment (vitest.config.ts) with no DOM, so `isEditableFocused`
 * (which reads `document.activeElement`) is exercised only in the browser;
 * here we assert the rule itself against duck-typed stand-ins shaped exactly
 * like the elements the browser hands over (tag / `type` / `isContentEditable`).
 */

/** Minimal stand-in for an element the browser reports as focused. */
const el = (tagName: string, props: Record<string, unknown> = {}): object => ({
  tagName,
  ...props,
});

describe("isEditableElement (§4.1.4 focus shield)", () => {
  it("treats a textarea and text-like inputs as keystroke owners", () => {
    expect(isEditableElement(el("TEXTAREA"))).toBe(true);
    expect(isEditableElement(el("INPUT", { type: "text" }))).toBe(true);
    expect(isEditableElement(el("INPUT", { type: "search" }))).toBe(true);
    expect(isEditableElement(el("INPUT", { type: "email" }))).toBe(true);
    // `<input>` with no type attribute defaults to type="text".
    expect(isEditableElement(el("INPUT"))).toBe(true);
  });

  it("treats contenteditable regions (incl. nested descendants) as editable", () => {
    // The browser computes `isContentEditable` for the whole subtree, so a
    // child of a contenteditable div reports true even though its own tag
    // is a plain inline element.
    expect(isEditableElement(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isEditableElement(el("SPAN", { isContentEditable: true }))).toBe(true);
    expect(isEditableElement(el("DIV", { isContentEditable: false }))).toBe(false);
  });

  it("keeps non-text inputs out of the shield (sliders/checkboxes must not swallow keys)", () => {
    expect(isEditableElement(el("INPUT", { type: "button" }))).toBe(false);
    expect(isEditableElement(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isEditableElement(el("INPUT", { type: "radio" }))).toBe(false);
    expect(isEditableElement(el("INPUT", { type: "range" }))).toBe(false);
    expect(isEditableElement(el("INPUT", { type: "submit" }))).toBe(false);
  });

  it("shields a focused <select> so Space/Enter navigate it instead of the screen", () => {
    // Regression: screens hijacked Space/Enter on a focused select, which the
    // browser needs to open/step the option list.
    expect(isEditableElement(el("SELECT"))).toBe(true);
  });

  it("leaves chrome and non-elements alone", () => {
    expect(isEditableElement(el("BODY"))).toBe(false);
    expect(isEditableElement(el("BUTTON"))).toBe(false);
    expect(isEditableElement(el("A"))).toBe(false);
    expect(isEditableElement(null)).toBe(false);
    expect(isEditableElement(undefined)).toBe(false);
    // `document` itself (older browsers' activeElement) has no tagName.
    expect(isEditableElement({})).toBe(false);
  });
});
