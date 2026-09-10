import { useMemo } from "react";

import {
  findTargetKey,
  FINGERS,
  getActiveLayout,
  type KeyboardLayout,
} from "../lib/layout";
import { cn } from "../lib/cn";

/**
 * On-screen keyboard rendered from a `KeyboardLayout` (§19) — no hard-coded
 * key positions. Highlights the physical key for `nextChar` (plus both Shift
 * keys when the char requires shift), exactly like the design mockup.
 * Reused by the Statistics heatmap in Phase 5.
 *
 * Phase 7 (§20): `highlightNextKey` and `fingerGuides` are wired to the
 * Settings toggles; both default on.
 */

interface KeyboardVisualizationProps {
  layout?: KeyboardLayout;
  /** Next expected character (Enter = "\n"). Null/undefined = no highlight. */
  nextChar?: string | null;
  className?: string;
  /** §20: pulse/highlight the upcoming key. */
  highlightNextKey?: boolean;
  /** §20: color-code keys by finger zone. */
  fingerGuides?: boolean;
}

/** Per-finger zone tints (the design's finger-guide color coding). */
const FINGER_TINT: Record<string, string> = {
  "pinky-l": "text-[#e0c0b1]",
  "ring-l": "text-[#d9b3a4]",
  "middle-l": "text-[#d4a68f]",
  "index-l": "text-[#cf9a7c]",
  thumb: "text-[#c9a08a]",
  "index-r": "text-[#cf9a7c]",
  "middle-r": "text-[#d4a68f]",
  "ring-r": "text-[#d9b3a4]",
  "pinky-r": "text-[#e0c0b1]",
};

export function KeyboardVisualization({
  layout = getActiveLayout(),
  nextChar = null,
  className,
  highlightNextKey = true,
  fingerGuides = true,
}: KeyboardVisualizationProps) {
  const { targetId, requiresShift } = useMemo(() => {
    if (!highlightNextKey || nextChar === null || nextChar === undefined) {
      return { targetId: null, requiresShift: false };
    }
    const target = findTargetKey(layout, nextChar);
    return {
      targetId: target?.key.id ?? null,
      requiresShift: target?.requiresShift ?? false,
    };
  }, [layout, nextChar, highlightNextKey]);

  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      {layout.rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex w-full gap-1.5">
          {row.map((key) => {
            const isTarget = key.id === targetId;
            const isShiftPartner =
              requiresShift && (key.id === "shift-l" || key.id === "shift-r");
            const highlighted = isTarget || isShiftPartner;
            const fingerMeta = FINGERS[key.finger];

            return (
              <div
                key={key.id}
                style={{ flexGrow: key.width ?? 1, flexBasis: 0 }}
                className={cn(
                  "flex h-11 min-w-0 items-center justify-center rounded-md border text-xs font-code-sm",
                  highlighted
                    ? "border-primary bg-primary-container font-bold text-on-primary-container shadow-[0_0_12px_rgb(249_115_22_calc(0.9_*_var(--accent-alpha)))] ring-1 ring-primary"
                    : "border-surface-container-highest/40 bg-surface-container text-on-surface-variant",
                  !highlighted && fingerGuides && key.kind !== "special" && FINGER_TINT[key.finger],
                  key.kind === "special" && !highlighted && "bg-surface-container-high text-[10px] text-outline",
                )}
                title={`${fingerMeta.label}${key.shift ? ` — shift: ${key.shift}` : ""}`}
              >
                {key.kind === "special" ? (
                  <span className="px-1">{key.label}</span>
                ) : key.shift !== undefined ? (
                  <span className="flex flex-col items-center leading-none">
                    <span className={cn("text-[10px]", highlighted ? "text-on-primary-container" : "text-outline")}>
                      {key.shift}
                    </span>
                    <span>{key.base === " " ? "" : key.base}</span>
                  </span>
                ) : key.base === " " ? (
                  <span className="text-[10px] text-outline-variant">SPACE</span>
                ) : (
                  key.base
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
