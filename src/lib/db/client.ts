import Database from "@tauri-apps/plugin-sql";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import * as schema from "./schema";

/**
 * Drizzle <-> tauri-plugin-sql bridge (MAIN_PLAN Phase 3 decision).
 *
 * tauri-plugin-sql owns the SQLite connection pool and applies the versioned
 * migrations baked into the Rust binary at startup; Drizzle provides the
 * typed query builder on top of it via the `sqlite-proxy` driver.
 *
 * Mapping (the one fiddly bit):
 * - `run`   -> plugin `execute` (INSERT/UPDATE/DELETE/DDL; result rows unused)
 * - `all`   -> plugin `select` (array of row objects)
 * - `get`   -> plugin `select`, first row (or null) as the single row
 * - `values`-> plugin `select` (object rows; the engine never uses array mode)
 */

export const DB_PATH = "sqlite:typing_trainer.db";

type PluginDatabase = Awaited<ReturnType<typeof Database.load>>;

let pluginDb: PluginDatabase | null = null;
let drizzleDb: SqliteRemoteDatabase<typeof schema> | null = null;

/**
 * Opens the plugin database once and enables WAL (PRD §25 performance) plus
 * FK enforcement, then hands it to the drizzle sqlite-proxy driver.
 * The returned instance is a singleton — call freely, it awaits lazily.
 */
export async function getDb(): Promise<SqliteRemoteDatabase<typeof schema>> {
  if (!drizzleDb) {
    pluginDb = await Database.load(DB_PATH);

    // Startup pragmas — journal_mode=WAL is the §25 storage-performance
    // requirement; foreign_keys keeps the §21.1 relationships honest.
    await pluginDb.execute("PRAGMA journal_mode = WAL;");
    await pluginDb.execute("PRAGMA foreign_keys = ON;");

    drizzleDb = drizzle(async (sql, params, method) => {
      const db = pluginDb!;
      if (method === "run") {
        await db.execute(sql, params);
        return { rows: [] };
      }
      const rows = await db.select<Record<string, unknown>[]>(sql, params);
      // sqlx returns row objects keyed by column name in result-column
      // order; drizzle's proxy mapper indexes rows POSITIONALLY
      // (row[columnIndex]), so convert to value arrays. Single-table
      // selects only — duplicate column names would collapse.
      if (method === "get") {
        return { rows: (rows[0] ? Object.values(rows[0]) : null) as never };
      }
      return { rows: rows.map((row) => Object.values(row)) as never };
    }, { schema });
  }
  return drizzleDb;
}

/**
 * TEST-ONLY: swaps the singleton for a custom drizzle instance (e.g. one
 * backed by `node:sqlite` in the repository integration tests). Not used in
 * the app runtime.
 */
export function setDbForTests(
  db: SqliteRemoteDatabase<typeof schema> | null,
): void {
  drizzleDb = db;
  if (db === null) pluginDb = null;
}

/**
 * Raw SQL through the plugin connection (bypasses the drizzle builder).
 * Used for pragmas that have no builder representation (WAL checkpoint).
 */
export async function rawExecute(query: string): Promise<void> {
  const db = pluginDb ?? (await Database.load(DB_PATH));
  pluginDb = db;
  await db.execute(query);
}

/**
 * §20 reset flow step: closes the plugin pool so the DB file can be deleted
 * (see `src/lib/io/reset.ts`). The next `getDb()` reopens and re-migrates.
 */
export async function closeDb(): Promise<void> {
  if (pluginDb !== null) {
    await pluginDb.close();
  }
  pluginDb = null;
  drizzleDb = null;
}

/**
 * Dev smoke test: verifies the plugin connection and the migrated schema are
 * reachable through the drizzle bridge. Called at app startup; failures
 * surface as a logged error, never a silent drop.
 */
export async function dbSmokeTest(): Promise<void> {
  const db = await getDb();
  await db.run(sql`SELECT 1`);
}
