/**
 * Number/duration formatting shared by the Dashboard and Statistics screens.
 * Every formatter is NaN-safe: falsy/undefined inputs render as zero values
 * (Phase 5 plan §2 — no NaN anywhere, including on a fresh DB).
 */

/** One-decimal fixed point ("54.2"). */
export function fmt1(value: number | null | undefined): string {
  return (Number.isFinite(value) ? (value as number) : 0).toFixed(1);
}

/** Grouped integer ("184,203"). */
export function fmtInt(value: number | null | undefined): string {
  return Math.round(Number.isFinite(value) ? (value as number) : 0).toLocaleString("en-US");
}

/** Signed one-decimal delta ("+3.4" / "-1.2"). */
export function fmtDelta(value: number | null | undefined): string {
  const safe = Number.isFinite(value) ? (value as number) : 0;
  return `${safe >= 0 ? "+" : ""}${safe.toFixed(1)}`;
}

/**
 * Compact duration: "38h 12m" for hours+, "11m 24s" for minutes+, "42s".
 */
export function fmtDuration(ms: number | null | undefined): string {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** Minutes for the goals panel ("11m of 15m goal"). */
export function fmtMinutes(minutes: number | null | undefined): string {
  const safe = Number.isFinite(minutes) ? (minutes as number) : 0;
  return safe >= 10 ? `${Math.round(safe)}m` : `${Math.floor(safe)}m ${Math.floor((safe % 1) * 60)}s`;
}

/** Relative time for attempt tables ("2m ago", "1h ago", "Yesterday"). */
export function fmtRelative(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** "SEP 05" style stamp for the goals panel. */
export function fmtDayStamp(ts: number): string {
  const date = new Date(ts);
  const month = date.toLocaleString("en-US", { month: "short" }).toUpperCase();
  return `${month} ${String(date.getDate()).padStart(2, "0")}`;
}

/** "3.14" module number from level + orderIndex. */
export function moduleNumber(level: number, orderIndex: number): string {
  return `${level}.${String(orderIndex + 1).padStart(2, "0")}`;
}
