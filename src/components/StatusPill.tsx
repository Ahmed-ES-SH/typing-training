import type { ReactNode } from "react";

import { cn } from "../lib/cn";

/**
 * StatusPill — the shared soft rounded status badge (plan §7.2). Replaces the
 * old rectangular terminal tags ([ RUNNING ], [ MASTERED ], [ LOCKED ]) with
 * calm, modern pill badges in semantic tones.
 */
export type StatusPillTone = "mastered" | "inProgress" | "available" | "locked" | "danger";

const TONE_CLASSES: Record<StatusPillTone, string> = {
  mastered: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  inProgress: "border-orange-500/20 bg-orange-500/10 text-orange-400",
  available: "border-transparent bg-surface-container-high text-on-surface-variant",
  locked: "border-transparent bg-surface-container-lowest text-outline/60",
  danger: "border-red-500/20 bg-red-500/10 text-red-400",
};

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusPillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
