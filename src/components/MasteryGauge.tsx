/**
 * MasteryGauge — the Dashboard hero's radial SVG ring (design: orange arc on
 * a muted track, centered percentage + "Overall", tier label beside it).
 * Pure SVG — no chart library, so it stays in the startup bundle.
 */

import { fmtPct } from "../lib/format";

const SIZE = 128;
const STROKE = 9;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function MasteryGauge({ pct }: { pct: number }) {
  const safePct = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  const dash = (safePct / 100) * CIRCUMFERENCE;

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="#31353f"
          strokeWidth={STROKE}
        />
        {safePct > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#f97316"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-headline-lg text-2xl font-bold tracking-tight text-on-surface">
          {fmtPct(safePct)}
        </span>
        <span className="font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
          Overall
        </span>
      </div>
    </div>
  );
}

/** Friendly progress phrase from the overall percentage. */
export function tierLabel(pct: number): string {
  const safePct = Math.max(0, Number.isFinite(pct) ? pct : 0);
  if (safePct >= 100) return "Curriculum cleared";
  if (safePct >= 70) return "Nearly there";
  if (safePct >= 40) return "Making progress";
  if (safePct >= 15) return "Getting started";
  return "Just starting out";
}
