import type { ReactNode } from "react";

/**
 * Layout wrapper for the whole app — the outermost element every screen
 * renders inside. Mirrors the `<body>` classes of the design mockups:
 * dark surface, Inter body type, non-selectable shell chrome.
 *
 * `h-screen` (not `min-h-screen`) + `overflow-hidden` pins the shell to the
 * viewport: with a min-height shell, tall flex children (e.g. the session
 * screen's 26-module drawer) inflate the page to their content height and
 * push everything below the fold out of view. Every screen scrolls
 * internally instead.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen select-none flex-col overflow-hidden bg-surface font-body-md text-body-md text-on-surface antialiased">
      {children}
    </div>
  );
}
