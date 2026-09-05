import type { ReactNode } from "react";

/**
 * Layout wrapper for the whole app — the outermost element every screen
 * renders inside. Mirrors the `<body>` classes of the design mockups:
 * dark surface, Inter body type, non-selectable shell chrome.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen select-none flex-col bg-surface font-body-md text-body-md text-on-surface antialiased">
      {children}
    </div>
  );
}
