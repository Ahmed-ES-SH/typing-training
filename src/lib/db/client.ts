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
 *
 * Serialization (why every statement goes through `enqueue`): the plugin
 * pools up to 10 sqlite connections and hands them out per statement, which
 * would (a) apply the per-connection FK pragma to only one connection and
 * (b) split separately-issued BEGIN/…/COMMIT across connections — the
 * transaction would not exist. Fully serialized statements keep the pool at
 * exactly one connection, so `withTransaction` can hold a real transaction
 * across drizzle callbacks (BEGIN and COMMIT are enqueued like any other
 * statement; the body's statements run between them, on the same connection).
 */

export const DB_PATH = "sqlite:typing_trainer.db";

type PluginDatabase = Awaited<ReturnType<typeof Database.load>>;
type DrizzleDb = SqliteRemoteDatabase<typeof schema>;

let pluginDb: PluginDatabase | null = null;
let drizzleDb: DrizzleDb | null = null;
let loadPromise: Promise<PluginDatabase> | null = null;

/* --------------------------- statement serialization ---------------------- */

let chain: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const result = chain.then(job, job);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Opens the plugin database at most once per connection lifetime (the
 * plugin's `load` always creates a NEW pool, so a second concurrent load
 * would leak one — and apply migrations from a racing caller's view).
 */
function ensurePluginDb(): Promise<PluginDatabase> {
  if (loadPromise === null) {
    loadPromise = (async () => {
      const db = await Database.load(DB_PATH);
      // Startup pragmas — journal_mode=WAL is the §25 storage-performance
      // requirement; foreign_keys keeps the §21.1 relationships honest.
      // Enqueued so they run (and stay set) on the pool's single connection.
      await enqueue(() => db.execute("PRAGMA journal_mode = WAL;"));
      await enqueue(() => db.execute("PRAGMA foreign_keys = ON;"));
      pluginDb = db;
      return db;
    })();
    // A failed load must not poison the singleton — retry on the next call.
    void loadPromise.catch(() => {
      if (loadPromise !== null) loadPromise = null;
    });
  }
  return loadPromise;
}

/* ------------------------------- reset window ------------------------------
 * closeDb() must not race fire-and-forget queries (debounced settings
 * persist, in-flight loads): a reentrant Database.load would recreate the
 * DB file mid-reset. suspendReopen() parks such callers until the reset
 * flow has deleted the files. */

let reopenGate: Promise<void> | null = null;
let releaseReopen: (() => void) | null = null;

export function suspendReopen(): void {
  if (reopenGate === null) {
    reopenGate = new Promise<void>((resolve) => {
      releaseReopen = resolve;
    });
  }
}

export function resumeReopen(): void {
  const release = releaseReopen;
  reopenGate = null;
  releaseReopen = null;
  release?.();
}

/**
 * Opens the plugin database once and enables WAL (PRD §25 performance) plus
 * FK enforcement, then hands it to the drizzle sqlite-proxy driver.
 * The returned instance is a singleton — call freely, it awaits lazily.
 */
export async function getDb(): Promise<DrizzleDb> {
  if (drizzleDb !== null) return drizzleDb;
  if (reopenGate !== null) await reopenGate;
  const db = await ensurePluginDb();
  if (drizzleDb === null) {
    drizzleDb = drizzle(async (sqlText, params, method) => {
      if (method === "run") {
        await enqueue(() => db.execute(sqlText, params));
        return { rows: [] };
      }
      const rows = await enqueue(() =>
        db.select<Record<string, unknown>[]>(sqlText, params),
      );
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
  db: DrizzleDb | null,
): void {
  drizzleDb = db;
  if (db === null) pluginDb = null;
}

/**
 * Raw SQL through the plugin connection (bypasses the drizzle builder).
 * Used for pragmas that have no builder representation (WAL checkpoint).
 */
export async function rawExecute(query: string): Promise<void> {
  if (reopenGate !== null) await reopenGate;
  const db = await ensurePluginDb();
  await enqueue(() => db.execute(query));
}

/**
 * Runs `fn`'s statements inside a REAL SQLite transaction. Because all
 * statements share the pool's single connection (see serialization note),
 * BEGIN/…/COMMIT hold together even though the plugin has no session API.
 * Unrelated concurrent statements interleave INTO the transaction (they run
 * on the same connection between BEGIN and COMMIT) — never around it.
 */
export async function withTransaction<T>(
  fn: (db: DrizzleDb) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  await enqueue(() => db.run(sql`BEGIN IMMEDIATE`));
  try {
    const result = await fn(db);
    await enqueue(() => db.run(sql`COMMIT`));
    return result;
  } catch (error) {
    await enqueue(() => db.run(sql`ROLLBACK`)).catch(() => undefined);
    throw error;
  }
}

/**
 * §20 reset flow step: closes the plugin pool so the DB file can be deleted
 * (see `src/lib/io/fileIo.ts`). Suspend reopen FIRST (resetDatabase does);
 * the next `getDb()` reopens and re-migrates.
 */
export async function closeDb(): Promise<void> {
  const db = pluginDb;
  pluginDb = null;
  drizzleDb = null;
  loadPromise = null;
  if (db !== null) {
    try {
      await db.close();
    } catch {
      // Pool already closed / closing — nothing to do.
    }
  }
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
