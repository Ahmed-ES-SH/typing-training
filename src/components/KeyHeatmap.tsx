import { useMemo } from "react";

import { fmt1, fmtInt } from "../lib/format";
import { getActiveLayout, type KeyboardLayout, type KeyDef } from "../lib/layout";
import { cn } from "../lib/cn";
import {
  buildHeatmapCells,
  BUCKET_LABELS,
  HEAT_BG,
  HEAT_TEXT,
  type CharAccuracy,
  type HeatCell,
} from "../lib/intelligence/heatmap";

/**
 * Key Heatmap (PRD §14; Phase 6 plan §3.5) — the statistics design's
 * heatmap section: colored keyboard + legend + four summary cards. Purely
 * presentational: per-char accuracies in, colored cells out. The compact
 * variant (no cards, smaller cells) is the in-session toggle.
 */

export const HEATMAP_LEGEND = BUCKET_LABELS;

function cellTooltip(cell: HeatCell): string {
  if (cell.kind === "special") return cell.label;
  if (cell.chars.length === 0) return `${cell.label} — no data yet`;
  const splits = cell.chars
    .map((c) => `${c.char === " " ? "␣" : c.char}: ${fmtInt(c.accuracy)}%`)
    .join(" · ");
  return `${cell.label} — ${cell.accuracy !== undefined ? fmt1(cell.accuracy) : "—"}% (${splits})`;
}

function HeatKey({
  cell,
  keyDef,
  compact,
}: {
  cell: HeatCell;
  keyDef: KeyDef;
  compact?: boolean;
}) {
  const bg = HEAT_BG[cell.bucket];
  const text = HEAT_TEXT[cell.bucket];
  const widthRem = compact ? 1.1 : 2; // key-units scale
  return (
    <div
      style={{
        ...(keyDef.width !== undefined ? { width: `${keyDef.width * widthRem}rem` } : {}),
        ...(cell.kind === "char" ? { backgroundColor: bg, color: text } : {}),
      }}
      className={cn(
        "flex h-9 items-center justify-center rounded font-bold shadow-sm",
        compact && "h-6 text-[9px]",
        keyDef.width !== undefined ? "flex-none" : compact ? "w-6 flex-none" : "w-14",
        cell.kind === "special" &&
          "bg-surface-container-high font-medium text-on-surface-variant",
      )}
      title={cellTooltip(cell)}
    >
      {cell.kind === "special" ? (
        <span className={cn("px-1", compact ? "text-[7px]" : "text-[10px]")}>{cell.label}</span>
      ) : cell.label === " " ? (
        <span className="text-outline">␣</span>
      ) : (
        cell.label
      )}
    </div>
  );
}

/** Derives the four design summary cards from the heat cells. */
function summaryCards(cells: HeatCell[], slowest: { char: string; latency: number }[]) {
  const withData = cells.filter((c) => c.accuracy !== null);
  const frequentlyIncorrect = [...withData]
    .sort((a, b) => b.misses - a.misses)
    .filter((c) => c.misses > 0)
    .slice(0, 6);
  const belowAverage = withData.filter((c) => c.bucket === "weak" || c.bucket === "below");
  const strong = withData.filter((c) => c.bucket === "strong");
  return { frequentlyIncorrect, belowAverage, strong, slowest };
}

function CardRow({
  title,
  entries,
  tone,
}: {
  title: string;
  entries: { label: string; detail: string }[];
  tone: string;
}) {
  return (
    <div className="rounded-lg bg-surface-container-lowest/60 px-3 py-2">
      <p className="font-code-sm text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </p>
      {entries.length === 0 ? (
        <p className="mt-1 font-code-sm text-code-sm text-outline">—</p>
      ) : (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {entries.map((entry) => (
            <span
              key={entry.label}
              className={cn(
                "flex items-baseline gap-1 rounded bg-surface-container px-1.5 py-0.5 font-code-md text-code-md",
                tone,
              )}
              title={entry.detail}
            >
              <strong className="font-bold">{entry.label}</strong>
              <span className="text-[10px] opacity-80">{entry.detail}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface KeyHeatmapProps {
  /** Per-char accuracy data (see `getCharAccuracy`). */
  data: CharAccuracy[];
  /** Lifetime slowest chars for the latency card (analyzer output). */
  slowest?: { key: string; avgLatencyMs: number }[];
  layout?: KeyboardLayout;
  /** Compact in-session variant (no cards, smaller cells). */
  compact?: boolean;
  className?: string;
}

export function KeyHeatmap({
  data,
  slowest = [],
  layout = getActiveLayout(),
  compact = false,
  className,
}: KeyHeatmapProps) {
  const cells = useMemo(() => buildHeatmapCells(layout, data), [layout, data]);
  const cellById = useMemo(
    () => new Map(cells.map((cell) => [cell.keyId, cell])),
    [cells],
  );
  const cards = useMemo(
    () =>
      summaryCards(
        cells,
        slowest.map((s) => ({ char: s.key, latency: s.avgLatencyMs })),
      ),
    [cells, slowest],
  );

  const keyboard = (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-surface-container-highest/30 bg-surface-container-lowest/70 font-code-sm text-code-sm",
        compact ? "gap-1 p-2" : "gap-1.5 p-space-base",
      )}
    >
      {layout.rows.map((row, rowIndex) => (
        <div key={rowIndex} className={cn("flex", compact ? "gap-0.5" : "gap-1.5")}>
          {row.map((keyDef) => (
            <HeatKey
              key={keyDef.id}
              keyDef={keyDef}
              compact={compact}
              cell={cellById.get(keyDef.id)!}
            />
          ))}
        </div>
      ))}
    </div>
  );

  if (compact) {
    return <div className={cn("flex w-full flex-col", className)}>{keyboard}</div>;
  }

  return (
    <div className={cn("flex flex-col gap-space-base", className)}>
      {/* Legend (design exact) */}
      <div className="flex flex-wrap items-center gap-space-md font-code-sm text-code-sm text-on-surface-variant">
        {HEATMAP_LEGEND.map(({ bucket, label }) => (
          <span key={bucket} className="flex items-center gap-1">
            <span
              className="h-3 w-3 rounded"
              style={{ backgroundColor: HEAT_BG[bucket] }}
            />
            {label}
          </span>
        ))}
      </div>

      {keyboard}

      {/* Four summary cards (design) */}
      <div className="grid grid-cols-1 gap-space-sm md:grid-cols-2 xl:grid-cols-4">
        <CardRow
          title="Frequently Incorrect"
          tone="text-error"
          entries={cards.frequentlyIncorrect.map((c) => ({
            label: c.chars.map((ch) => ch.char).join(""),
            detail: `${c.misses} misses`,
          }))}
        />
        <CardRow
          title="Below Average"
          tone="text-secondary"
          entries={cards.belowAverage.flatMap((c) =>
            c.chars.map((ch) => ({
              label: ch.char,
              detail: `${ch.accuracy.toFixed(0)}%`,
            })),
          )}
        />
        <CardRow
          title="Strong"
          tone="text-primary"
          entries={cards.strong.slice(0, 8).flatMap((c) =>
            c.chars
              .filter((ch) => ch.accuracy >= 97)
              .map((ch) => ({
                label: ch.char,
                detail: `${ch.accuracy.toFixed(0)}%`,
              })),
          )}
        />
        <CardRow
          title="Slowest Latency"
          tone="text-on-surface"
          entries={cards.slowest.map((s) => ({
            label: s.char,
            detail: `${Math.round(s.latency)}ms`,
          }))}
        />
      </div>
    </div>
  );
}
