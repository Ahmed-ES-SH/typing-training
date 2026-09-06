import { cn } from "../lib/cn";
import { fmtInt, fmtMinutes } from "../lib/format";
import type { DayConsistency, DayStatus } from "../lib/stats/dailyService";

/**
 * Consistency strip (Phase 8 plan §3.3, PRD §18).
 *
 * Dashboard variant (`compact`): last 14 days, one cell per day beneath the
 * goals panel. Statistics variant (`wide`): the same data as a 90-day bar
 * row under the charts. Both read precomputed `DayConsistency` cells — no
 * queries happen here. Nothing fancier (no GitHub-style calendar).
 *
 * Cell states stay on-palette: met = orange fill, partial = amber,
 * missed = error, inactive = muted surface. The current day pulses.
 */

const CELL_TONE: Record<DayStatus, string> = {
  met: "bg-primary-container",
  partial: "bg-secondary-container/70",
  missed: "bg-error/60",
  inactive: "bg-surface-container-highest/50",
};

/** Glyph tone per cell (token-based, so all three themes stay legible). */
const CELL_TEXT: Record<DayStatus, string> = {
  met: "text-on-primary-container",
  partial: "text-on-secondary-container",
  missed: "text-on-error-container",
  inactive: "text-outline",
};

const STATUS_LABEL: Record<DayStatus, string> = {
  met: "goals met",
  partial: "partial progress",
  missed: "trained, goals missed",
  inactive: "rest day",
};

function cellTip(cell: DayConsistency, isToday: boolean): string {
  const head = isToday ? "Today" : cell.date;
  const streak = cell.streakDay !== null ? ` • streak day ${cell.streakDay}` : "";
  return (
    `${head}: ${STATUS_LABEL[cell.status]}${streak}\n` +
    `${fmtMinutes(cell.minutes)} trained • ${cell.lessons} lesson(s) • ` +
    `${fmtInt(cell.chars)} chars • ${cell.metGoals}/${cell.enabledGoals} goals`
  );
}

function weekdayOf(date: string): string {
  return "SMTWTFS"[new Date(`${date}T12:00:00`).getDay()] ?? "";
}

export function ConsistencyStrip({
  days,
  variant,
  loading = false,
}: {
  days: DayConsistency[];
  variant: "compact" | "wide";
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div
        aria-label="Loading consistency"
        className={cn(
          "flex gap-1",
          variant === "compact" ? "h-9" : "h-16 items-end",
        )}
      >
        {Array.from({ length: variant === "compact" ? 14 : 90 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-sm bg-surface-container-highest/40"
          />
        ))}
      </div>
    );
  }

  if (variant === "wide") {
    const maxMinutes = Math.max(1, ...days.map((d) => d.minutes));
    const first = days[0]?.date ?? "";
    const last = days[days.length - 1]?.date ?? "";
    return (
      <div>
        <div
          role="img"
          aria-label={`Daily consistency, ${first} to ${last}: ${days.filter((d) => d.status === "met").length} goal-met days out of ${days.length}`}
          className="flex h-16 items-end gap-[2px]"
        >
          {days.map((cell, index) => {
            const isToday = index === days.length - 1;
            return (
              <div
                key={cell.date}
                title={cellTip(cell, isToday)}
                className={cn(
                  "min-w-0 flex-1 rounded-sm",
                  CELL_TONE[cell.status],
                  isToday && "animate-pulse ring-1 ring-primary",
                )}
                style={{ height: `${Math.max(8, (cell.minutes / maxMinutes) * 100)}%` }}
              />
            );
          })}
        </div>
        <div className="mt-1 flex items-center justify-between font-code-sm text-[10px] uppercase tracking-wider text-outline">
          <span>{first}</span>
          <span>{days.filter((d) => d.status === "met").length} met / {days.length} days</span>
          <span>{last} (today)</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        role="img"
        aria-label={`Last ${days.length} days consistency: ${days.filter((d) => d.status === "met").length} goal-met days`}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((cell, index) => {
          const isToday = index === days.length - 1;
          return (
            <div
              key={cell.date}
              title={cellTip(cell, isToday)}
              className={cn(
                "flex h-9 flex-col items-center justify-center rounded",
                CELL_TONE[cell.status],
                isToday && "animate-pulse ring-1 ring-primary",
              )}
            >
              <span
                className={cn(
                  "font-code-sm text-[9px] font-bold leading-none",
                  CELL_TEXT[cell.status],
                )}
              >
                {cell.status === "met" ? "✓" : weekdayOf(cell.date)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-code-sm text-[9px] uppercase tracking-wider text-outline">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-primary-container" /> met
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-secondary-container/70" /> partial
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-error/60" /> missed
        </span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-sm bg-surface-container-highest/50" /> rest
        </span>
      </div>
    </div>
  );
}
