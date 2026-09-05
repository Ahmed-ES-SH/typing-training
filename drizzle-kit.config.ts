import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config — generates versioned SQL migrations from
 * `src/lib/db/schema.ts` into `src-tauri/migrations/` (`pnpm db:generate`).
 * The SQL files are committed to the repo and registered in
 * `src-tauri/src/lib.rs` via `tauri_plugin_sql::Builder::add_migrations`.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./src-tauri/migrations",
});
