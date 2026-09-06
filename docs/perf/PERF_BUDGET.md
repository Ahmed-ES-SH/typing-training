# Phase 8 Performance Budget Report (§25)

Measured evidence for the §25 non-functional requirements. Every number
below is produced by a checked-in harness — re-run, don't trust.

| Budget (plan §2) | Measured | Evidence |
|---|---|---|
| Cold start → interactive shell ≤ 1.5 s | Instrumented, pending target-hardware run (see §1) | `performance.mark` chain in `src/main.tsx` + `src/App.tsx`, dev-logged |
| First keystroke echo < 16 ms (one frame) | ~0.03 ms/key engine-side (33,903 keys/s incl. metrics) | `src/lib/engine/throughput.test.ts` |
| Statistics/Dashboard interactive < 300 ms | Queries index-backed (µs–ms at 2k-row volume); wall-clock pending target run | `src/lib/db/indexAudit.test.ts` |
| Idle CPU ≈ 0 (no timers when not in session) | 1 interval site, stopped outside sessions (audit §4) | code audit, `rg setInterval` |
| RSS ≤ 150 MB steady-state | Pending target-hardware run (see §1) | procedure in §1 |
| DB write batched per session finish | 1 multi-row key upsert + 1 attempt INSERT + 1 session UPDATE | `useSessionStore.persistFinishedSession` |
| Startup chunk < 400 KB gzip | **183.5 KB gzip** entry; recharts lazy (99.9 KB chart chunk) | `pnpm perf:budget` (this build) |

## 1. Startup & bundle (measured 2026-09-06, `pnpm build` + `pnpm perf:budget`)

```
[perf:budget] entry chunks (before first paint):
  /assets/index-*.js — 629.8 KB (183.5 KB gzip)
[perf:budget] lazy chunks (fetched on navigation):
  assets/CartesianChart-*.js — 332.5 KB (99.9 KB gzip)
  assets/SparklineChart-*.js — 15.2 KB (5.6 KB gzip)
  assets/StatisticsScreen-*.js — 43.1 KB (12.7 KB gzip)
  assets/WeaknessTrainingScreen-*.js — 22.5 KB (6.7 KB gzip)
```

- Entry stays chart-free: Statistics + Weakness Training are `React.lazy`
  (`src/App.tsx`); nothing imports recharts outside the lazy routes (the
  `useStatsStore` dynamic-import warning in the build log is the
  settings-hydration path reusing the already-loaded store — no duplicate
  chart code ships).
- Cold-start wall-clock and RSS are measured at packaging (Phase 9) on
  target hardware: `pnpm tauri build`, install, launch with network
  disabled, read the dev-logged
  `[perf] main → first screen data ready: … ms` line and the process RSS
  after 30 min idle. Budgets: ≤ 1500 ms, RSS flat ≤ 150 MB.

## 2. Keystroke path (measured)

```
[perf] engine throughput: 33903 keys/s (10000 keys in 295 ms, budget > 500/s)
```

- Synthetic 10k-keystroke session through the real reducer
  (`applyEvent`) with `liveMetrics` recomputation on the 200 ms tick
  cadence. Per-key engine work ≈ 30 µs — three orders of magnitude inside
  the 16 ms echo budget; the remainder is one React commit of memoized
  buffer rows (`CodeBuffer` lines memoize on `engineState.content`, live
  telemetry recomputes on the 200 ms store tick, never per keystroke).
- No layout thrash by construction: keystrokes update zustand state only;
  the caret line scrolls via a single `scrollIntoView({ block: "nearest" })`
  on position change.

## 3. Database (measured, `EXPLAIN QUERY PLAN` at 2k-attempt volume)

```
attempt-pagination : SCAN lesson_attempts USING INDEX idx_lesson_attempts_finished_at
daily-series       : SEARCH lesson_attempts USING INDEX idx_lesson_attempts_finished_at (finished_at>?) // TEMP B-TREE FOR GROUP BY
lesson-history     : SEARCH lesson_attempts USING INDEX idx_lesson_attempts_lesson_id (lesson_id=?) // TEMP B-TREE FOR ORDER BY
sessions-by-day    : SCAN training_sessions // TEMP B-TREE FOR GROUP BY
progress-by-day    : SCAN lesson_progress // TEMP B-TREE FOR GROUP BY
```

Disposition per query (plan §3.4):

- **Index-backed, no change:** pagination, daily series (range-bound, the
  per-visit hot paths), lesson history, key-stats upserts (PK), daily
  rollups (`idx_key_statistics_daily_date`), bigram lookups.
- **Bounded scans, accepted without migration:** `training_sessions`
  (one row per session) and `lesson_progress` (one row per lesson) lack
  range indexes, but both tables grow O(sessions)/O(lessons) — three
  orders of magnitude below the attempt ledger — and every read is
  window-bounded (14/90-day strips). The consistency strip reconciles
  exactly against these tables (`dailyProgress.test.ts`). **No migration
  v4:** per the plan's preference, schema stays frozen; revisit only if a
  wall-clock regression appears.
- **Write batching (already):** one `training_sessions` row opened per
  session, one batched close at finish; key statistics merge in a single
  multi-row upsert; attempts append in one INSERT. WAL + FK pragmas on
  open (`src/lib/db/client.ts`).

## 4. Idle CPU / background work (audit)

- Exactly one `setInterval` site in shipped code: the 200 ms session tick
  (`src/stores/useSessionStore.ts`), started on `startLesson`/`startDrill`
  and stopped on finish/abandon/reset. No timers run outside an active
  session; `TopBar`/stats re-query only on data invalidation, never on a
  poll.
- `setTimeout` sites are persist/validation debounces (settings, goals,
  custom-lesson form) — one-shot, never periodic.
- **Zero network handles at runtime:** no `fetch`/`WebSocket` in shipped
  code (the only URL is the user-clicked "Check for updates" opener;
  `fetch(` strings elsewhere are lesson *typing content*, never
  executed). Fonts/icons are vendored (`public/fonts`, compiled Tailwind).

## 5. Reproduce

```sh
pnpm test                       # throughput + index audit print [perf] lines
pnpm build && pnpm perf:budget  # bundle report (exit 2 if over budget)
```

Docs: this file + `scripts/perf-budget.mjs` + the two `*.test.ts` harnesses.
