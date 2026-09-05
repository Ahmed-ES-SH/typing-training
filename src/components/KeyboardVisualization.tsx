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
 */

interface KeyboardVisualizationProps {
  layout?: KeyboardLayout;
  /** Next expected character (Enter = "\n"). Null/undefined = no highlight. */
  nextChar?: string | null;
  className?: string;
}

export function KeyboardVisualization({
  layout = getActiveLayout(),
  nextChar = null,
  className,
}: KeyboardVisualizationProps) {
  const { targetId, requiresShift } = useMemo(() => {
    if (nextChar === null || nextChar === undefined) {
      return { targetId: null, requiresShift: false };
    }
    const target = findTargetKey(layout, nextChar);
    return {
      targetId: target?.key.id ?? null,
      requiresShift: target?.requiresShift ?? false,
    };
  }, [layout, nextChar]);

  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      {layout.rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex justify-center gap-1">
          {row.map((key) => {
            const isTarget = key.id === targetId;
            const isShiftPartner =
              requiresShift && (key.id === "shift-l" || key.id === "shift-r");
            const highlighted = isTarget || isShiftPartner;
            const fingerMeta = FINGERS[key.finger];

            return (
              <div
                key={key.id}
                style={key.width !== undefined ? { width: `${key.width * 2}rem` } : undefined}
                className={cn(
                  "flex h-7 min-w-8 items-center justify-center rounded border text-[10px] font-code-sm",
                  key.width !== undefined ? "flex-none" : "w-8",
                  highlighted
                    ? "border-primary bg-primary-container font-bold text-on-primary-container shadow-[0_0_12px_rgba(249,115,22,0.9)] ring-1 ring-primary"
                    : "border-surface-container-highest/40 bg-surface-container text-on-surface-variant",
                  key.kind === "special" && !highlighted && "bg-surface-container-high text-[9px] text-outline",
                )}
                title={`${fingerMeta.label}${key.shift ? ` — shift: ${key.shift}` : ""}`}
              >
                {key.kind === "special" ? (
                  <span className="px-1">{key.label}</span>
                ) : key.shift !== undefined ? (
                  <span className="flex flex-col items-center leading-none">
                    <span className={cn("text-[8px]", highlighted ? "text-on-primary-container" : "text-outline")}>
                      {key.shift}
                    </span>
                    <span>{key.base === " " ? "" : key.base}</span>
                  </span>
                ) : key.base === " " ? (
                  <span className="text-[9px] text-outline-variant">SPACE</span>
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
