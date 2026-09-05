import { getScreen } from "../lib/screens";
import { useUiStore } from "../stores/useUiStore";

/**
 * Shared 40px top status bar, matching the header block of every
 * `screens/*_typekernel/code.html` design.
 *
 * Static placeholder values (streak / WPM) — real data arrives in later
 * phases. The traffic dots are decorative; native Tauri window decorations
 * remain enabled.
 */
export function TopBar() {
  const activeScreen = useUiStore((state) => state.activeScreen);
  const { label, icon } = getScreen(activeScreen);

  return (
    <header className="z-40 flex h-10 shrink-0 items-center justify-between border-b border-surface-container-highest/40 bg-surface-container-lowest/95 px-space-base shadow-[0_1px_8px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex items-center gap-space-sm">
        {/* Decorative traffic-dot cluster (native decorations stay enabled) */}
        <div className="flex items-center gap-space-xs">
          <div className="h-3 w-3 cursor-pointer rounded-full bg-surface-container-highest transition-colors hover:bg-error" />
          <div className="h-3 w-3 cursor-pointer rounded-full bg-surface-container-highest transition-colors hover:bg-secondary" />
          <div className="h-3 w-3 cursor-pointer rounded-full bg-surface-container-highest transition-colors hover:bg-primary" />
        </div>

        <div className="flex items-center gap-space-xs rounded bg-surface-container px-space-xs py-space-2xs font-code-sm text-code-sm text-on-surface-variant">
          <span className="h-1.5 w-1.5 rounded-full bg-primary-container" />
          TAURI v2.1.0-OFFLINE
        </div>

        <div className="hidden items-center gap-space-2xs rounded bg-surface-container-high px-space-xs py-space-2xs font-code-sm text-code-sm text-primary md:flex">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-container" />
          <span>{label.toUpperCase()}</span>
        </div>

        <span className="material-symbols-outlined text-[15px] text-primary-container">
          {icon}
        </span>
      </div>

      <div className="flex items-center gap-space-md">
        {/* Static demo values until daily-goals logic lands (Phase 8) */}
        <div className="hidden items-center gap-space-xs font-code-sm text-code-sm text-on-surface-variant sm:flex">
          <span className="material-symbols-outlined text-[15px] text-primary-container">
            local_fire_department
          </span>
          <span className="text-primary">12-DAY STREAK</span>
        </div>
        <div className="hidden h-3.5 w-px bg-surface-container-highest sm:block" />
        <div className="flex items-center gap-space-xs font-code-sm text-code-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-[14px] text-primary">
            bolt
          </span>
          <span>118 WPM AVG</span>
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
