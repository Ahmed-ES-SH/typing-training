import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * StatCard — the flat metric cards shared by the Dashboard's rolling stats
 * strip and the Statistics screen's header row (plan §7.3: flat container,
 * clean number typography, subtle muted labels).
 */
export function StatCard({
  icon,
  label,
  value,
  unit,
  note,
  noteTone = "muted",
  className,
}: {
  icon: string;
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  noteTone?: "muted" | "positive" | "negative";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-white/5 bg-surface-container-low/60 p-4",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
        <span className="material-symbols-outlined text-[16px] text-primary-container">
          {icon}
        </span>
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-code-lg text-xl font-bold tracking-tight text-on-surface">
          {value}
        </span>
        {unit && (
          <span className="text-xs text-on-surface-variant">{unit}</span>
        )}
        {note && (
          <span
            className={cn(
              "text-xs font-medium",
              noteTone === "positive" && "text-primary",
              noteTone === "negative" && "text-error",
              noteTone === "muted" && "text-on-surface-variant",
            )}
          >
            {note}
          </span>
        )}
      </span>
    </div>
  );
}
