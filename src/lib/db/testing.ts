import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";

import { setDbForTests } from "./client";
import * as schema from "./schema";

/**
 * TEST-ONLY harness: an in-memory SQLite (`node:sqlite`) wired into the
 * drizzle sqlite-proxy exactly like `client.ts` maps the plugin, with the
 * REAL generated migration SQL applied in order. Lets repository and
 * progress-service tests run against a genuine SQLite engine without the GUI.
 */
export function connectTestDb(): DatabaseSync {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const migrationsDir = new URL("../../../src-tauri/migrations/", import.meta.url);
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, migrationsDir), "utf8");
    sqlite.exec(sql);
  }

  const proxy = drizzle(async (sql, params, method) => {
    // tauri-plugin-sql serialises params through JSON -> sqlx, which stores
    // JS booleans as SQLite integers; mirror that here for node:sqlite.
    const bound = params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
    if (method === "run") {
      sqlite.prepare(sql).run(...bound);
      return { rows: [] };
    }
    const rows = sqlite.prepare(sql).all(...bound) as Record<string, unknown>[];
    // Mirror client.ts: drizzle's proxy mapper indexes rows positionally.
    if (method === "get") {
      return { rows: (rows[0] ? Object.values(rows[0]) : null) as never };
    }
    return { rows: rows.map((row) => Object.values(row)) as never };
  }, { schema });

  setDbForTests(proxy);
  return sqlite;
}
