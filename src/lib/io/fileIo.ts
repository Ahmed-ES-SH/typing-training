import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { openUrl } from "@tauri-apps/plugin-opener";

import { closeDb, DB_PATH, rawExecute } from "../db/client";

/**
 * Tauri-side plumbing for §17 import/export and the §20 reset flow — kept in
 * ONE thin module, strictly separate from the pure envelope core
 * (`exportSchema.ts` / `exporter.ts` / `importer.ts`) so the core stays
 * unit-testable headless. Every function degrades gracefully outside the
 * Tauri runtime (browser preview) by returning null.
 *
 * Filesystem scope (§5 + capabilities/README.md): JSON files are only ever
 * touched at paths the user picked in the native dialog — the dialog plugin
 * extends the fs scope at runtime. No static broad grants exist.
 */

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const JSON_FILTER = {
  name: "TypeKernel JSON",
  extensions: ["json"],
};

/** Save dialog -> write the payload; returns the path (null = cancelled). */
export async function saveTextFile(
  defaultName: string,
  contents: string,
): Promise<string | null> {
  if (!inTauri()) return null;
  const path = await save({ defaultPath: defaultName, filters: [JSON_FILTER] });
  if (path === null) return null;
  await writeTextFile(path, contents);
  return path;
}

/** Open dialog -> read the file; returns path + contents (null = cancelled). */
export async function readTextFileViaDialog(): Promise<{
  path: string;
  contents: string;
} | null> {
  if (!inTauri()) return null;
  const path = await open({ multiple: false, filters: [JSON_FILTER] });
  if (path === null) return null;
  return { path, contents: await readTextFile(path) };
}

/** Manual-only update check (§5): opens the releases page in the browser. */
export async function checkForUpdates(): Promise<boolean> {
  if (!inTauri()) return false;
  await openUrl(RELEASES_URL);
  return true;
}

export const RELEASES_URL =
  "https://github.com/typekernel/typing-trainer/releases/latest";

/* ------------------------------- reset flow -------------------------------- */

/** The SQLite file + WAL/SHM sidecars, as the sql plugin resolves them
 * (app config dir). Only these exact files are deletable (capability scope). */
async function dbFilePaths(): Promise<string[]> {
  const dir = await appConfigDir();
  const base = DB_PATH.replace(/^sqlite:/, "");
  return Promise.all(
    ["", "-wal", "-shm"].map((suffix) => join(dir, `${base}${suffix}`)),
  );
}

export interface ResetResult {
  removed: number;
}

/**
 * §20 reset: WAL checkpoint -> close pool -> delete the DB file (and WAL
 * sidecars) -> reopen (migrations re-run on the fresh file). The CALLER
 * re-seeds the curriculum afterwards (bootstrap) and reloads the stores.
 * Irreversible — the Settings screen wraps this in the typed-RESET dialog.
 */
export async function resetDatabase(): Promise<ResetResult> {
  if (!inTauri()) return { removed: 0 };
  // 1. Checkpoint the WAL so no data lingers in the -wal sidecar.
  await rawExecute("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => undefined);
  // 2. Close the pool — the plugin otherwise holds the file open.
  await closeDb();
  // 3. Delete DB + sidecars (scoped fs permission: these three paths only).
  let removed = 0;
  for (const path of await dbFilePaths()) {
    if (await exists(path).catch(() => false)) {
      await remove(path);
      removed += 1;
    }
  }
  return { removed };
}
