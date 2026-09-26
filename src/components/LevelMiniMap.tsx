import { cn } from "../lib/cn";

/**
 * LevelMiniMap (UX plan §6.2) — the compact right-edge jump rail listing
 * L1..L7 with a completion fill and percentage. Clicking a level smooth-
 * scrolls its header into view (the screen owns the section refs). Levels
 * filtered out of the current view dim and report `aria-disabled` (staying
 * in the accessibility tree so "hidden by filters" is announced) rather than
 * jump to an anchor that is not rendered.
 */
export interface MiniMapEntry {
  level: number;
  /** Full level name — surfaced as the tooltip/aria-label. */
  name: string;
  /** Uppercase tier label from the level meta (e.g. "SYMBOLS"). */
  tier: string;
  completed: number;
  total: number;
  /** Rounded 0–100 completion percentage. */
  pct: number;
  complete: boolean;
  /** The frontier level (contains an available lesson). */
  current: boolean;
  /** False when the active filters removed this level from the view. */
  visible: boolean;
}

export function LevelMiniMap({
  entries,
  onJump,
}: {
  entries: MiniMapEntry[];
  onJump: (level: number) => void;
}) {
  return (
    <nav
      aria-label="Level mini-map"
      className="fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-xl border border-surface-container-highest/50 bg-surface-container-low/90 p-space-xs shadow-xl backdrop-blur-md xl:flex"
    >
      <span className="mb-1 font-code-sm text-[9px] uppercase tracking-widest text-on-surface-variant">
        Levels
      </span>
      {entries.map((entry) => (
        <button
          key={entry.level}
          type="button"
          aria-disabled={!entry.visible}
          onClick={() => {
            if (!entry.visible) return;
            onJump(entry.level);
          }}
          title={
            entry.visible
              ? `Level ${entry.level} — ${entry.name} · ${entry.tier} (${entry.completed}/${entry.total})`
              : `Level ${entry.level} hidden by filters`
          }
          aria-label={
            entry.visible
              ? `Jump to level ${entry.level} — ${entry.completed}/${entry.total} lessons complete (${entry.pct}%)`
              : `Level ${entry.level} hidden by filters`
          }
          className={cn(
            "flex w-11 flex-col items-center gap-1 rounded-lg py-1.5 transition-all",
            entry.visible
              ? "hover:bg-surface-container"
              : "cursor-not-allowed opacity-35",
            entry.current && entry.visible
              ? "bg-primary-container/15 ring-1 ring-primary-container/60"
              : undefined,
          )}
        >
          <span
            className={cn(
              "font-code-sm text-[10px] font-bold",
              entry.current && entry.visible
                ? "text-primary"
                : entry.complete
                  ? "text-secondary"
                  : "text-on-surface-variant",
            )}
          >
            L{entry.level}
          </span>
          <span className="h-1.5 w-7 overflow-hidden rounded-full bg-surface-container-highest">
            <span
              className={cn(
                "block h-full rounded-full",
                entry.complete ? "bg-secondary" : "bg-primary-container",
              )}
              style={{ width: `${entry.pct}%` }}
            />
          </span>
          <span
            className={cn(
              "font-code-sm text-[9px] leading-none",
              entry.complete
                ? "text-secondary"
                : entry.current && entry.visible
                  ? "text-primary"
                  : "text-on-surface-variant/70",
            )}
          >
            {entry.complete ? "100%" : `${entry.pct}%`}
          </span>
        </button>
      ))}
    </nav>
  );
}
