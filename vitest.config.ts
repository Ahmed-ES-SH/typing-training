import { defineConfig } from "vitest/config";

/**
 * Vitest runs the pure engine/metrics tests in node — no DOM, no Tauri,
 * no plugins needed. Kept separate from `vite.config.ts` (which carries the
 * Tauri/tailwind app build setup).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
