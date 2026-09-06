import { describe, expect, it } from "vitest";

import { applyEvent, createSession } from "./engine";

/**
 * §20 backspace policy wiring (Phase 7): the Settings policy feeds the
 * engine's counting mode via `SessionOptions.backspacePolicy`.
 */

const typeThree = () => {
  let state = createSession("abcd");
  for (const char of ["a", "b", "x"]) {
    state = applyEvent(state, { type: "char", char }, 1000 + state.totalKeystrokes * 10);
  }
  return state; // position 3: a✓ b✓ x✗ — session NOT finished (4 chars)
};

describe("engine backspace policy", () => {
  it("counted (default): backspace fixes the cell and counts", () => {
    let state = typeThree();
    state = applyEvent(state, { type: "backspace" }, 2000);
    expect(state.position).toBe(2);
    expect(state.backspaceCount).toBe(1);
    state = applyEvent(state, { type: "char", char: "c" }, 2100);
    expect(state.position).toBe(3);
    expect(state.correctChars).toBe(3);
    // Counters are cumulative: the earlier miss stays in the tally even
    // though the cell was fixed (§9 semantics).
    expect(state.incorrectChars).toBe(1);
    expect(state.backspaceCount).toBe(1);
  });

  it("free: backspace fixes the cell but is never counted", () => {
    let state = typeThree();
    state = applyEvent(state, { type: "backspace" }, 2000, { backspacePolicy: "free" });
    expect(state.position).toBe(2);
    expect(state.backspaceCount).toBe(0);
    state = applyEvent(state, { type: "char", char: "c" }, 2100, { backspacePolicy: "free" });
    expect(state.correctChars).toBe(3);
    expect(state.incorrectChars).toBe(1); // cumulative tally, cell is fixed
    expect(state.backspaceCount).toBe(0);
  });

  it("forbidden: backspace is a no-op — the buffer only moves forward", () => {
    let state = typeThree();
    state = applyEvent(state, { type: "backspace" }, 2000, { backspacePolicy: "forbidden" });
    expect(state.position).toBe(3);
    expect(state.backspaceCount).toBe(0);
    // A forbidden policy session cannot be corrected; the wrong char stands.
    expect(state.incorrectChars).toBe(1);
  });
});
