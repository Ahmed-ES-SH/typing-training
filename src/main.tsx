import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { dbSmokeTest } from "./lib/db/client";
import "./styles.css";

/**
 * Startup instrumentation (Phase 8 §3.4 "Performance tooling").
 *
 * `typekernel:main-start` fires before the first module work; the shell
 * mount and first-screen marks are recorded in `App.tsx`. In dev the full
 * chain is logged so the §25 cold-start budget (≤ 1.5 s) is measured, not
 * vibes. Marks are near-free in production and never leave the machine.
 */
performance.mark("typekernel:main-start");

// Open the database at startup: tauri-plugin-sql applies the versioned
// migrations inside Rust on first load, and we enable WAL + FK pragmas.
// Failures are logged, never fatal (UI surfaces persistence errors later).
void dbSmokeTest().catch((error) => {
  console.error("[db] startup initialization failed:", error);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

performance.mark("typekernel:shell-mounted");
performance.measure(
  "typekernel:main-to-shell",
  "typekernel:main-start",
  "typekernel:shell-mounted",
);
if (import.meta.env.DEV) {
  const [measure] = performance.getEntriesByName("typekernel:main-to-shell");
  // eslint-disable-next-line no-console
  console.info(
    `[perf] main → shell mounted: ${measure?.duration.toFixed(1) ?? "?"} ms (budget: cold start ≤ 1500 ms)`,
  );
}
