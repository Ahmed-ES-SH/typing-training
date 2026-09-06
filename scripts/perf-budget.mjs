/**
 * Startup bundle budget check (Phase 8 plan §3.4 "Performance tooling").
 *
 * Reads the entry chunks referenced by `dist/index.html` (the scripts the
 * browser fetches before first paint — lazy screens/charts excluded) and
 * asserts their combined gzip size stays under the §25 budget of 400 KB.
 * Prints a full per-chunk report either way for `docs/perf/`.
 *
 * Usage: `pnpm build && pnpm perf:budget` (exits 2 when dist/ is missing).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const BUDGET_GZIP_BYTES = 400 * 1024;

function fail(message) {
  console.error(`[perf:budget] ${message}`);
  process.exit(2);
}

if (!existsSync(join(DIST, "index.html"))) {
  fail("dist/ not built — run `pnpm build` first.");
}

const html = readFileSync(join(DIST, "index.html"), "utf8");
// Entry scripts + modulepreloads = everything fetched before first paint.
const entryRefs = new Set([
  ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
]);

const rows = [];
for (const ref of entryRefs) {
  const file = join(DIST, ref.replace(/^\//, ""));
  if (!existsSync(file) || !file.endsWith(".js")) continue;
  const raw = readFileSync(file);
  rows.push({ file: ref, bytes: raw.length, gzip: gzipSync(raw).length });
}

// Full chunk report (lazy chunks included for context).
const assetDir = join(DIST, "assets");
const lazy = [];
if (existsSync(assetDir)) {
  for (const name of readdirSync(assetDir).filter((n) => n.endsWith(".js"))) {
    const ref = `assets/${name}`;
    if ([...entryRefs].some((e) => e.includes(name))) continue;
    const raw = readFileSync(join(assetDir, name));
    lazy.push({ file: ref, bytes: raw.length, gzip: gzipSync(raw).length });
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log("[perf:budget] entry chunks (before first paint):");
for (const r of rows) console.log(`  ${r.file} — ${kb(r.bytes)} (${kb(r.gzip)} gzip)`);
console.log("[perf:budget] lazy chunks (fetched on navigation):");
for (const r of lazy) console.log(`  ${r.file} — ${kb(r.bytes)} (${kb(r.gzip)} gzip)`);

const totalGzip = rows.reduce((n, r) => n + r.gzip, 0);
console.log(
  `[perf:budget] entry total: ${kb(totalGzip)} gzip (budget ${kb(BUDGET_GZIP_BYTES)})`,
);
if (totalGzip > BUDGET_GZIP_BYTES) {
  fail(`OVER BUDGET by ${kb(totalGzip - BUDGET_GZIP_BYTES)} — split the entry chunk.`);
}
console.log("[perf:budget] PASS — startup chunk within budget.");
