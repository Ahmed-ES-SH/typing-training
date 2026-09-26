import { useEffect, useState } from "react";

import { cn } from "../lib/cn";

/**
 * Daily-goal progress ring (UX plan §5.3, PRD §18).
 *
 * The arc paints at 0 on first commit and only receives the real percentage
 * inside an effect (one rAF later), so EVERY mount sweeps to its value —
 * including the first Dashboard paint after a goal turns green, which is
 * what makes the §5.4 completed-state animation fire on remount. Under
 * reduced motion the global kill switch drops the transition, but the
 * resting state is still the real percentage, never 0.
 *
 * `pct` is clamped to 0–100 for the ARC while the centre keeps the real
 * value (over-achievement stays visible); `met` adds the subtle primary ring
 * + check pop (Tailwind-only, no neon glow); `disabled` renders the muted
 * "off" ring. Token colours only — `currentColor` strokes driven by `text-*`
 * utilities, so every theme stays legible.
 */
export function GoalRing({
  label,
  value,
  target,
  pct,
  met,
  disabled = false,
}: {
  label: string;
  value: string;
  target: string;
  /** Raw progress (may exceed 100 or be non-finite) — clamped for the arc. */
  pct: number;
  met: boolean;
  disabled?: boolean;
}) {
  const clamped = disabled
    ? 0
    : Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  const [swept, setSwept] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSwept(clamped));
    return () => cancelAnimationFrame(frame);
  }, [clamped]);

  const circumference = 2 * Math.PI * 42;
  const offset = circumference * (1 - swept / 100);
  const ariaLabel = disabled
    ? `${label}: goal off`
    : `${label}: ${value} of ${target}${met ? ", goal met" : ""}`;

  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div
        className={cn(
          "relative h-[72px] w-[72px] shrink-0 rounded-full transition-all duration-500 ease-out",
          disabled ? "opacity-50" : met && "ring-2 ring-primary/60 shadow-md",
        )}
      >
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox="0 0 100 100"
          className="h-full w-full -rotate-90"
        >
          <circle
            cx="50"
            cy="50"
            fill="none"
            r="42"
            stroke="currentColor"
            strokeWidth="9"
            className={disabled ? "text-surface-container-highest/60" : "text-surface-container-highest"}
          />
          <circle
            cx="50"
            cy="50"
            fill="none"
            r="42"
            stroke="currentColor"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            strokeWidth="9"
            className={cn(
              "transition-[stroke-dashoffset] duration-700 ease-out",
              disabled
                ? "text-outline/40"
                : met
                  ? "text-primary"
                  : "text-secondary",
            )}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {disabled ? (
            <span className="font-code-sm text-[10px] font-bold uppercase tracking-wider text-outline">
              off
            </span>
          ) : (
            <>
              <span className="font-code-sm text-[12px] font-bold leading-none text-on-surface">
                {value}
              </span>
              <span className="mt-0.5 font-code-sm text-[9px] leading-none text-outline">
                {target}
              </span>
            </>
          )}
        </div>
        {met && !disabled && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-on-primary shadow-md transition-transform duration-500 ease-out",
              swept >= 100 ? "scale-100" : "scale-0",
            )}
          >
            ✓
          </span>
        )}
      </div>
      <span className="text-center font-code-sm text-[9px] uppercase tracking-wider text-on-surface-variant">
        {label}
      </span>
    </div>
  );
}
