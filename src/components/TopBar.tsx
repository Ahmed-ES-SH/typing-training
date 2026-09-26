import { useEffect, useState } from "react";

import { cn } from "../lib/cn";
import { statsRepo } from "../lib/db/repositories";
import { getStreak } from "../lib/stats/dailyService";
import { getScreen } from "../lib/screens";
import { useSessionStore } from "../stores/useSessionStore";
import { useStatsStore } from "../stores/useStatsStore";
import { useUiStore } from "../stores/useUiStore";

/** UX plan §5.2.3 — the traffic-light order: close, minimize, maximize. */
const TRAFFIC_DOTS = [
  { action: "close", title: "Close", base: "bg-[#ff5f57]/80", hover: "hover:bg-[#ff5f57]" },
  { action: "minimize", title: "Minimize", base: "bg-[#febc2e]/80", hover: "hover:bg-[#febc2e]" },
  { action: "maximize", title: "Maximize", base: "bg-[#28c840]/80", hover: "hover:bg-[#28c840]" },
] as const;

type TrafficAction = (typeof TRAFFIC_DOTS)[number]["action"];

/**
 * §5.2.3 — drives the native Tauri window. The API is imported dynamically
 * behind a `__TAURI_INTERNALS__` guard so plain-browser dev (`pnpm dev`
 * outside the desktop shell) renders inert dots instead of crashing on a
 * missing bridge; a rejected capability degrades the same way.
 */
async function runWindowAction(action: TrafficAction): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    else if (action === "maximize") await appWindow.toggleMaximize();
    else {
      // Closing kills the process without letting React unmount — close the
      // open training-session row first (§3.7 abandon path), or it leaks.
      await useSessionStore.getState().abandon().catch(() => undefined);
      await appWindow.close();
    }
  } catch (error) {
    // No window permission / not a real window — chrome clicks never crash.
    if (import.meta.env.DEV) console.warn("window action failed", error);
  }
}

/**
 * Shared 40px top status bar. The streak / WPM read-outs are LIVE values
 * (SQL-backed services, re-read when the stats caches invalidate) so the
 * chrome can never contradict the Dashboard panels — with graceful "—"
 * placeholders on a fresh database.
 *
 * Left: the §5.2.3 macOS traffic dots (real window controls) and the
 * breadcrumb. Right: telemetry, the §5.1 `Ctrl+K` palette hint and avatar.
 */
export function TopBar() {
  const activeScreen = useUiStore((s) => s.activeScreen);
  const { label, icon } = getScreen(activeScreen);
  const version = useStatsStore((s) => s.version);
  const [streak, setStreak] = useState<number | null>(null);
  const [avgWpm, setAvgWpm] = useState<number | null>(null);

  // Cheap: two aggregate queries per invalidation (attempt finished,
  // abandoned, or demo-seeded), never per keystroke or navigation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [streakInfo, overview] = await Promise.all([
          getStreak(),
          statsRepo.overview(),
        ]);
        if (cancelled) return;
        setStreak(streakInfo.current);
        setAvgWpm(overview.attempts > 0 ? overview.avgWpm : null);
      } catch {
        if (!cancelled) {
          setStreak(null);
          setAvgWpm(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <header className="z-40 flex h-10 shrink-0 items-center justify-between border-b border-surface-container-highest/40 bg-surface-container-lowest/95 px-space-base shadow-[0_1px_8px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex items-center gap-space-sm">
        {/* §5.2.3 — real window controls behind the macOS traffic dots. */}
        <div className="flex items-center gap-1.5">
          {TRAFFIC_DOTS.map((dot) => (
            <button
              key={dot.action}
              type="button"
              title={dot.title}
              aria-label={dot.title}
              onClick={() => void runWindowAction(dot.action)}
              className={cn(
                "h-3 w-3 rounded-full transition-all duration-150",
                "hover:scale-110 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                dot.base,
                dot.hover,
              )}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-sm font-semibold text-on-surface">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
          TypeKernel
        </div>

        <span aria-hidden="true" className="text-sm text-outline/60">
          /
        </span>

        <div className="hidden items-center gap-space-xs text-sm text-on-surface-variant md:flex">
          <span className="material-symbols-outlined text-[15px] text-outline">
            {icon}
          </span>
          <span>{label}</span>
        </div>
      </div>

      <div className="flex items-center gap-space-md">
        <div className="hidden items-center gap-space-xs text-xs text-on-surface-variant sm:flex">
          <span className="material-symbols-outlined text-[15px] text-primary">
            local_fire_department
          </span>
          <span>
            {streak !== null && streak > 0 ? `${streak}-day streak` : "No streak yet"}
          </span>
        </div>
        <div className="hidden h-3.5 w-px bg-white/10 sm:block" />
        <div className="flex items-center gap-space-xs text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-[14px] text-primary">
            bolt
          </span>
          <span>{avgWpm !== null ? `${Math.round(avgWpm)} WPM avg` : "— WPM avg"}</span>
        </div>
        {/* §5.1 discoverability — the command palette is one chord away.
            A real button that re-enters the existing chord path: the synthetic
            Ctrl+K hits GlobalHotkeys' capture listener and the pure decision
            function, so every guard (and the opener capture) still applies —
            no new event channel. */}
        <button
          type="button"
          title="Open the command palette"
          onClick={(event) => {
            // Focus first so the palette can hand focus back on close
            // (WebKit does not focus buttons on click).
            event.currentTarget.focus();
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
            );
          }}
          className="hidden items-center gap-1 rounded-lg border border-white/10 bg-surface-container-low px-2 py-1 text-on-surface-variant md:flex"
        >
          <span className="material-symbols-outlined text-[14px] text-outline">
            keyboard_command_key
          </span>
          <kbd className="rounded border border-white/10 bg-surface-container-lowest px-1.5 py-0.5 text-[10px]">
            Ctrl K
          </kbd>
        </button>
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary">
          <span className="material-symbols-outlined text-[16px] text-on-primary">
            person
          </span>
        </div>
      </div>
    </header>
  );
}
