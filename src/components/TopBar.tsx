import { useEffect, useState } from "react";

import { statsRepo } from "../lib/db/repositories";
import { getStreak } from "../lib/stats/dailyService";
import { getScreen } from "../lib/screens";
import { useStatsStore } from "../stores/useStatsStore";
import { useUiStore } from "../stores/useUiStore";

/**
 * Shared 40px top status bar. The streak / WPM read-outs are LIVE values
 * (SQL-backed services, re-read when the stats caches invalidate) so the
 * chrome can never contradict the Dashboard panels — with graceful "—"
 * placeholders on a fresh database.
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
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary">
          <span className="material-symbols-outlined text-[16px] text-on-primary">
            person
          </span>
        </div>
      </div>
    </header>
  );
}
