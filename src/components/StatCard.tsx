import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * StatCard — the hero aggregate chips shared by the Dashboard's rolling
 * stats strip and the Statistics screen's header row (design: icon + small
 * uppercase label, bold value, muted note).
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
        "flex flex-col gap-0.5 rounded-xl border border-surface-container-highest/40 bg-surface-container-lowest/60 px-space-base py-space-sm shadow-md",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 font-code-sm text-[10px] uppercase tracking-wider text-on-surface-variant">
        <span className="material-symbols-outlined text-[14px] text-primary-container">
          {icon}
        </span>
        {label}
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="font-code-lg text-xl font-bold tracking-tight text-on-surface">
          {value}
        </span>
        {unit && (
          <span className="font-code-sm text-code-sm text-on-surface-variant">{unit}</span>
        )}
        {note && (
          <span
            className={cn(
              "font-code-sm text-[11px] font-semibold",
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
