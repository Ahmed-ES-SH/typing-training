import { describe, expect, it } from "vitest";

import {
  isHeatmapToggle,
  isInstantReset,
  isTabResetChord,
  isZenToggle,
  resultsActionFor,
  TAB_RESET_WINDOW_MS,
} from "./goldenLoop";

const pass = { canAdvance: true, hasAttempt: true };
const fail = { canAdvance: false, hasAttempt: true };
const noAttempt = { canAdvance: false, hasAttempt: false };
const drill = { canAdvance: false, hasAttempt: true, canDrill: true };

describe("resultsActionFor (§4.1.1 Smart Enter)", () => {
  it("advances on Enter when the attempt passed and a next lesson unlocked", () => {
    expect(resultsActionFor({ key: "Enter" }, pass)).toBe("next-lesson");
  });

  it("NEVER dead-ends Enter on a failed attempt — it retries instead", () => {
    // The regression this whole section exists for: Enter used to do nothing.
    expect(resultsActionFor({ key: "Enter" }, fail)).toBe("retry-lesson");
    // …and a pass with no next lesson (curriculum finished) still restarts.
    expect(resultsActionFor({ key: "Enter" }, { canAdvance: false, hasAttempt: true })).toBe(
      "retry-lesson",
    );
  });

  it("replays the current lesson on Space for both verdicts", () => {
    expect(resultsActionFor({ key: " " }, pass)).toBe("retry-lesson");
    expect(resultsActionFor({ key: " " }, fail)).toBe("retry-lesson");
  });

  it("returns to the curriculum on Esc regardless of the verdict", () => {
    expect(resultsActionFor({ key: "Escape" }, pass)).toBe("curriculum");
    expect(resultsActionFor({ key: "Escape" }, noAttempt)).toBe("curriculum");
  });

  it("leaves modified Escape chords to the OS / window manager", () => {
    // Doc contract: Alt/Meta combos resolve to null — Alt+Escape must NOT
    // be claimed as "back to curriculum".
    expect(resultsActionFor({ key: "Escape", altKey: true }, pass)).toBeNull();
    expect(resultsActionFor({ key: "Escape", metaKey: true }, pass)).toBeNull();
    expect(resultsActionFor({ key: "Escape", ctrlKey: true }, pass)).toBeNull();
  });

  it("claims Ctrl+R as retry and leaves other combos to the shell", () => {
    expect(resultsActionFor({ key: "r", ctrlKey: true }, fail)).toBe("retry-lesson");
    expect(resultsActionFor({ key: "R", ctrlKey: true }, fail)).toBe("retry-lesson");
    expect(resultsActionFor({ key: "k", ctrlKey: true }, pass)).toBeNull();
    expect(resultsActionFor({ key: "1", altKey: true }, pass)).toBeNull();
    expect(resultsActionFor({ key: "q", metaKey: true }, pass)).toBeNull();
  });

  it("gates Ctrl+R NOT on hasAttempt — retry lands while the payload loads", () => {
    // Documented contract (ResultsKeyContext.hasAttempt): a reload must
    // never slip through out from under the Results screen, even before
    // Enter/Space/D are allowed to do anything.
    expect(resultsActionFor({ key: "r", ctrlKey: true }, noAttempt)).toBe("retry-lesson");
    expect(resultsActionFor({ key: "R", ctrlKey: true }, noAttempt)).toBe("retry-lesson");
    expect(resultsActionFor({ key: "Enter" }, noAttempt)).toBeNull();
  });

  it("ignores Enter/Space until an attempt payload exists", () => {
    expect(resultsActionFor({ key: "Enter" }, noAttempt)).toBeNull();
    expect(resultsActionFor({ key: " " }, noAttempt)).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(resultsActionFor({ key: "x" }, pass)).toBeNull();
    expect(resultsActionFor({ key: "Tab" }, pass)).toBeNull();
  });
});

describe("resultsActionFor (§7.1 D → targeted micro-drill)", () => {
  it("claims the bare D when a micro-drill is offered", () => {
    expect(resultsActionFor({ key: "d" }, drill)).toBe("drill-micro");
    // The badge reads [D]: Shift+d (or Caps-Lock d) is the same physical key.
    expect(resultsActionFor({ key: "D" }, { ...drill, canAdvance: true })).toBe("drill-micro");
    expect(resultsActionFor({ key: "D", shiftKey: true }, drill)).toBe("drill-micro");
  });

  it("stays silent when there is nothing to drill", () => {
    // No `canDrill` flag at all (e.g. no missed keys ≥ 2) → key is inert.
    expect(resultsActionFor({ key: "d" }, fail)).toBeNull();
    expect(
      resultsActionFor({ key: "d" }, { canAdvance: false, hasAttempt: true, canDrill: false }),
    ).toBeNull();
  });

  it("ignores D until an attempt payload exists", () => {
    expect(
      resultsActionFor({ key: "d" }, { canAdvance: false, hasAttempt: false, canDrill: true }),
    ).toBeNull();
  });

  it("leaves D + modifier combos to the shell", () => {
    expect(resultsActionFor({ key: "d", ctrlKey: true }, drill)).toBeNull();
    expect(resultsActionFor({ key: "D", metaKey: true }, drill)).toBeNull();
    expect(resultsActionFor({ key: "d", altKey: true }, drill)).toBeNull();
    expect(resultsActionFor({ key: "d", ctrlKey: true, shiftKey: true }, drill)).toBeNull();
  });

  it("never shadows the existing Enter/Space/Esc/Ctrl+R semantics", () => {
    expect(resultsActionFor({ key: "Enter" }, { ...drill, canAdvance: true })).toBe("next-lesson");
    expect(resultsActionFor({ key: "Enter" }, drill)).toBe("retry-lesson");
    expect(resultsActionFor({ key: " " }, drill)).toBe("retry-lesson");
    expect(resultsActionFor({ key: "Escape" }, drill)).toBe("curriculum");
    expect(resultsActionFor({ key: "r", ctrlKey: true }, drill)).toBe("retry-lesson");
  });
});

describe("isTabResetChord (§4.1.2 instant reset)", () => {
  const armed = 1_000;

  it("fires on Enter inside the window after a Tab press", () => {
    expect(isTabResetChord({ key: "Enter" }, armed, armed + 10)).toBe(true);
    expect(
      isTabResetChord({ key: "Enter" }, armed, armed + TAB_RESET_WINDOW_MS),
    ).toBe(true);
  });

  it("expires after the window and never fires when unarmed", () => {
    expect(
      isTabResetChord({ key: "Enter" }, armed, armed + TAB_RESET_WINDOW_MS + 1),
    ).toBe(false);
    expect(isTabResetChord({ key: "Enter" }, 0, armed + 1)).toBe(false);
  });

  it("never hijacks a modified Enter or a non-Enter key", () => {
    expect(isTabResetChord({ key: "Enter", ctrlKey: true }, armed, armed + 1)).toBe(false);
    expect(isTabResetChord({ key: "Enter", altKey: true }, armed, armed + 1)).toBe(false);
    expect(isTabResetChord({ key: " " }, armed, armed + 1)).toBe(false);
  });
});

describe("isInstantReset (§4.1.2 Ctrl+R)", () => {
  it("claims Ctrl+R / Cmd+R only", () => {
    expect(isInstantReset({ key: "r", ctrlKey: true })).toBe(true);
    expect(isInstantReset({ key: "R", ctrlKey: true })).toBe(true);
    expect(isInstantReset({ key: "r", metaKey: true })).toBe(true);
    expect(isInstantReset({ key: "k", ctrlKey: true })).toBe(false);
    expect(isInstantReset({ key: "r" })).toBe(false);
  });
});

describe("isZenToggle (§4.1.3 Zen / Focus Mode)", () => {
  it("accepts Ctrl+Shift+F mid-run", () => {
    expect(isZenToggle({ key: "f", ctrlKey: true, shiftKey: true }, true)).toBe(true);
    expect(isZenToggle({ key: "F", metaKey: true, shiftKey: true }, true)).toBe(true);
  });

  it("never eats the letter f while the session is running", () => {
    // Binding bare `f` during a run would swallow a legitimate keystroke.
    expect(isZenToggle({ key: "f" }, true)).toBe(false);
    expect(isZenToggle({ key: "F", shiftKey: true }, true)).toBe(false);
    // Ctrl+F stays the browser's find; Ctrl+Shift+F is the chord.
    expect(isZenToggle({ key: "f", ctrlKey: true }, true)).toBe(false);
    expect(isZenToggle({ key: "f", altKey: true, shiftKey: true, ctrlKey: true }, true)).toBe(
      false,
    );
  });

  it("accepts the bare F while nothing is being typed", () => {
    expect(isZenToggle({ key: "f" }, false)).toBe(true);
    expect(isZenToggle({ key: "f", ctrlKey: true, shiftKey: true }, false)).toBe(true);
    expect(isZenToggle({ key: "F", shiftKey: true }, false)).toBe(false);
    expect(isZenToggle({ key: "g" }, false)).toBe(false);
  });
});

describe("isHeatmapToggle (§7.3 in-session heatmap glance)", () => {
  it("accepts Ctrl+Shift+H / Cmd+Shift+H mid-run", () => {
    expect(isHeatmapToggle({ key: "h", ctrlKey: true, shiftKey: true }, true)).toBe(true);
    expect(isHeatmapToggle({ key: "H", metaKey: true, shiftKey: true }, true)).toBe(true);
  });

  it("never eats the letter h while the session is running", () => {
    // Same rule as bare `F`: binding `h` during a run would swallow input.
    expect(isHeatmapToggle({ key: "h" }, true)).toBe(false);
    expect(isHeatmapToggle({ key: "H", shiftKey: true }, true)).toBe(false);
    // Plain Ctrl+H stays the shell's chord — only the Shift chord is claimed.
    expect(isHeatmapToggle({ key: "h", ctrlKey: true }, true)).toBe(false);
    expect(isHeatmapToggle({ key: "h", altKey: true, shiftKey: true, ctrlKey: true }, true)).toBe(
      false,
    );
  });

  it("accepts the bare h while nothing is being typed", () => {
    expect(isHeatmapToggle({ key: "h" }, false)).toBe(true);
    expect(isHeatmapToggle({ key: "h", ctrlKey: true, shiftKey: true }, false)).toBe(true);
    expect(isHeatmapToggle({ key: "H", shiftKey: true }, false)).toBe(false);
    expect(isHeatmapToggle({ key: "g" }, false)).toBe(false);
  });
});
