import { Suspense, lazy } from "react";

/**
 * Sparkline — the Dashboard's 7-day WPM mini area chart. Recharts itself is
 * loaded through a lazy inner component so the Dashboard (and the startup
 * chunk) never pulls the chart library in (§25 / plan §2 bundle rule).
 */

export interface SparkPoint {
  /** Numeric x (epoch ms) — ticks stay mono/terse on this micro chart. */
  x: number;
  y: number;
}

const SparklineChart = lazy(() => import("./SparklineChart"));

export function Sparkline({
  points,
  height = 56,
  color = "#f97316",
}: {
  points: SparkPoint[];
  height?: number;
  color?: string;
}) {
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-surface-container-highest bg-surface-container-lowest/40 font-code-sm text-[10px] uppercase tracking-wider text-outline"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }
  return (
    <Suspense fallback={<div style={{ height }} />}>
      <SparklineChart points={points} height={height} color={color} />
    </Suspense>
  );
}
