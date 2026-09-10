import { useState } from "react";

import { SCREENS } from "../lib/screens";
import { useUiStore } from "../stores/useUiStore";
import { cn } from "../lib/cn";

/**
 * Global left navigation sidebar (Phase 8 chrome). Lists the six
 * directly-navigable screens; `typing-session` and `lesson-results` are
 * contextual (they need a lesson/attempt param) and are only reached
 * through the curriculum flows, so they stay out of the rail.
 *
 * Collapsible to an icon-only rail; the choice persists in localStorage —
 * it is pure view chrome, not a synced preference.
 */

const NAV_ITEMS = SCREENS.filter(
  (screen) => screen.id !== "typing-session" && screen.id !== "lesson-results",
);

const COLLAPSE_KEY = "typekernel.nav-collapsed";

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function NavSidebar() {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const activeScreen = useUiStore((s) => s.activeScreen);

  const toggle = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, prev ? "0" : "1");
      } catch {
        // Private-mode storage — collapse still works for this session.
      }
      return !prev;
    });
  };

  return (
    <nav
      aria-label="App navigation"
      className={cn(
        "z-30 flex shrink-0 select-none flex-col border-r border-surface-container-highest/40 bg-surface-container-lowest/95 shadow-[1px_0_8px_rgba(0,0,0,0.35)] transition-all duration-200",
        collapsed ? "w-14" : "w-52",
      )}
    >
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto p-space-xs">
        {NAV_ITEMS.map((screen) => {
          const active = screen.id === activeScreen;
          return (
            <li key={screen.id}>
              <button
                type="button"
                onClick={() => useUiStore.getState().navigate(screen.id)}
                aria-current={active ? "page" : undefined}
                title={screen.label.replace(/_/g, " ")}
                className={cn(
                  "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 font-code-sm text-code-sm transition-colors",
                  active
                    ? "bg-primary-container/15 font-bold text-primary"
                    : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                )}
              >
                {active && (
                  <span className="absolute bottom-1.5 left-0 top-1.5 w-1 rounded-r bg-primary-container shadow-[0_0_8px_rgb(249_115_22_calc(0.8_*_var(--accent-alpha)))]" />
                )}
                <span
                  className={cn(
                    "material-symbols-outlined shrink-0 text-[18px]",
                    active ? "text-primary-container" : "text-outline",
                  )}
                >
                  {screen.icon}
                </span>
                {!collapsed && <span className="truncate">{screen.label}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 border-t border-surface-container-highest/40 p-space-xs">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[18px]">
            {collapsed ? "keyboard_double_arrow_right" : "keyboard_double_arrow_left"}
          </span>
          {!collapsed && <span className="font-code-sm text-code-sm">Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
