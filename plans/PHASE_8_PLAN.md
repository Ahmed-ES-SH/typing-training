# PHASE 8 PLAN — Daily Training, Performance & Polish

**Parent:** [MAIN_PLAN.md](./MAIN_PLAN.md) → Phase 8
**PRD sections covered:** §18 (Daily Training / consistency), §25 (Performance non-functionals), §2 (goals context), full-PRD QA sweep (§26 walkthrough)
**Design reference:** `screens/dashboard_typekernel/` (goals panel, streak, consistency additions stay on-palette — no new mockup needed)
**Depends on:** Phase 7 exit criteria met (feature-complete app, settings store, real backup values)
**Status:** Planned — not started. Implementation contract for Phase 8 only.

---

## 1. Goal

Close the product out before packaging: finish the **daily training / consistency system** (§18 — goal editing, daily tracking, streaks, consistency view), run a targeted **performance pass** against §25's non-functional requirements, and sweep the whole app for UX polish and PRD compliance. This phase is deliberately small-scope, high-verification: it turns "feature-complete" into "release candidate".

**Explicitly out of scope:** packaging/installers/offline-audit (Phase 9); any new features — anything discovered here that isn't a PRD requirement goes to a post-1.0 backlog.

---

## 2. Design Decisions (fixed before coding)

| Topic | Decision | Rationale |
|---|---|---|
| Goal model | Per-day goals stored once (not per-date rows): `daily_goals` row keyed `date = 'default'` holding `minutes/lessons/chars` (0 = goal disabled); per-date rows are written only as *overrides* (Phase 5 seeded defaults migrate here) | §18 "optional goals"; keeps the DB tiny and the logic trivial |
| Goal completion semantics | A day's goals are "met" when **all enabled** goals for that day are reached; partial progress always visible (design's 3 progress bars); meeting goals is celebrated with a subtle state change (bar → filled + check glyph), no modals | §18 "lightweight… complements, does not replace" |
| Consistency view | Dashboard gains a compact **last-14-days strip** (per-day: met/partial/missed markers + minutes) beneath the goals panel; Statistics gains the same data as a 90-day bar row — nothing fancier (no GitHub-style calendar) | §18 "tracking daily time, lessons, chars, streaks, consistency" without bloating scope |
| Goal editing | Settings → Training Preferences unlocks the design's `15 min/day • 3 lessons • 500 chars` inputs (Phase 5/7 left them read-only); 0 disables a goal; validated by Zod (0–480 min, 0–100 lessons, 0–100k chars) | §18 "optional goals" |
| Streak rule | Unchanged from Phase 5's definition; a goal-miss does **not** break a streak (only inactivity does) — documented in a tooltip | Keeps streaks motivating; avoids punishing rest days |
| Performance budget (§25, measured not vibes) | Cold start → interactive shell ≤ 1.5 s on target hardware; first keystroke echo < 16 ms (one frame); Statistics/Dashboard interactive < 300 ms; idle CPU ≈ 0 (no timers when not in session); RSS ≤ 150 MB steady-state; DB write batched per session finish (already) | §25 bullets turned into enforceable numbers |
| Performance tooling | `perf` budget script: startup timestamp instrumentation (`performance.mark`) logged in dev; bundle-size budget in CI-equivalent check (`dist` chunk report); a timed typing harness (synthetic 10k-keystroke session) asserting engine throughput | §25 must be verifiable at exit, not vibes |
| Polish sweep scope | Keyboard-only navigation (full tab order, visible focus rings on token palette, Esc semantics per screen), empty/error/loading states for every async surface, consistent number/time formatting (one util), monospace rendering audit (box-drawing/arrow chars in lesson content), window title follows screen | §25 "smooth", §20 UX coherence; no redesign |

---

## 3. Tasks

### 3.1 Daily goals service (§18)
- `dailyGoalsRepo`: read/write default row + per-date overrides; Zod bounds.
- `dailyService` extension (Phase 5): `todayProgress()` merges goals × actuals → per-goal `{ target, actual, pct, met }`; `metAllToday()`.
- Tests: disabled goals (0), override precedence over defaults, midnight-boundary behavior (local time).

### 3.2 Goal editing UI
- Settings → Training Preferences: enable/edit the three goal inputs (design's inline number fields) with Zod validation and instant persist (Phase 7 store pattern).
- Dashboard goals panel: shows current goals + live bars; a met-day renders the design-consistent completed state.

### 3.3 Consistency strip
- `ConsistencyStrip` component: last 14 days, one cell per day (met / partial / missed / inactive), current-day pulse; tooltip per §18 metrics (minutes, lessons, chars, streak day #).
- Dashboard placement under the goals panel (sidebar column); Statistics gets the 90-day variant under the charts. Reuses `dailyService` — no new queries beyond a 90-day session-group read.

### 3.4 Performance pass (§25)
- **Startup:** instrument `performance.mark` chain (main.tsx → shell mounted → first screen data ready); eliminate any sync work before first paint (defer seeding logs, lazy screens already); target ≤ 1.5 s cold.
- **Keystroke path:** audit the session input path for re-render scope (engine reducer + memoized buffer rows); synthetic 10k-keystroke harness must sustain > 500 keys/s with metrics recomputation on 200 ms ticks; no layout thrash (profiler trace archived in `docs/perf/`).
- **Memory/CPU:** 30-min idle session logs RSS ≈ flat (no leaks from charts/engines); verify zero timers/intervals outside active sessions; zero network handles.
- **DB:** `EXPLAIN QUERY PLAN` on the hot queries (dashboard aggregates, attempt pagination, key-stats upsert) — all index-backed; add missing indexes only with a migration v4 note.
- **Bundle:** startup chunk budget (< 400 KB gzip); recharts/engines confirmed lazy (Phase 5/6 work, re-verified).

### 3.5 UX polish sweep
- Keyboard-only pass: every interactive element reachable + operable; focus rings styled (`outline` on token palette); shortcuts audited (`Enter` resume, `Esc` back, `Ctrl+R` retry — no browser conflicts, Tauri context); screen-reader labels on icon-only buttons (lucide/Material icons).
- State sweep: every async surface (dashboard cards, lessons list, stats, custom list, import/export dialogs) has loading skeleton / empty / error triad; error toasts follow one component.
- Formatting: single `format.ts` (WPM decimals, %, durations, relative time) — replaces ad-hoc formatting from earlier phases.
- Window title syncs with active screen ("TypeKernel — Lessons"); app icon taskbar path already set by Phase 9 prep if pulled forward.

### 3.6 Full PRD compliance audit
- Walk PRD §26 flow end-to-end on Wayland: open → dashboard → lesson → session (live §9 metrics) → results → unlock → repeat; weakness drill evolves; custom lesson practiced; backup round-trips; goals tracked.
- §2 core goals checklist (all 12) ticked in `docs/PRD_CHECKLIST.md` with evidence links (test names / screenshots).
- Fix-or-file: anything found gets fixed if PRD-scoped, else logged to backlog.

---

## 4. File Change Summary

| File | Change |
|---|---|
| `src/lib/stats/dailyGoalsRepo.ts` (+test) | New — goal model + bounds |
| `src/lib/stats/dailyService.ts` | Extend — todayProgress, metAllToday |
| `src/components/ConsistencyStrip.tsx` | New — 14/90-day consistency views |
| `src/screens/SettingsScreen.tsx` | Goal inputs enabled (Training section) |
| `src/screens/DashboardScreen.tsx` | Consistency strip + met-state goals panel |
| `src/screens/StatisticsScreen.tsx` | 90-day consistency row |
| `src/lib/format.ts` | New — shared formatting |
| `src-tauri/migrations/0004_goal_defaults.sql` | Only if Phase 5's seeded defaults need reshaping (preferred: no migration — data-only move) |
| `docs/perf/*`, `docs/PRD_CHECKLIST.md` | New — budget evidence + audit record |

---

## 5. Verification (phase exit criteria)

1. **§18 acceptance:** set goals (e.g. 15 min / 3 lessons / 500 chars) → train → bars fill → met-state renders; disable a goal → bar disappears from the met calculation; streak survives a goal-miss day; consistency strip matches `training_sessions` for the last 14 days exactly.
2. **§25 budget report:** measured cold start ≤ 1.5 s, first-keystroke echo < 16 ms, interactive screens < 300 ms, idle RSS flat over 30 min, startup bundle under budget — numbers recorded in `docs/perf/`.
3. Keyboard-only: complete an entire session (open → type → results → next lesson) without touching the mouse.
4. State sweep: every screen's loading/empty/error state exercised (fresh DB, killed DB file scenario, failed import) — no raw exceptions reach the user.
5. PRD audit: `docs/PRD_CHECKLIST.md` — all §2 goals, §6 coverage, §7/§8 behavior, §9–§12 metrics, §13–§18 features, §20 screens, §21 persistence, §24 history rule evidenced green.
6. Regressions: full vitest suite green; manual smoke of phases 2–7 core flows after the sweep.

---

## 6. Handoff to Phase 9

Phase 9 receives a release-candidate: measured performance evidence for the packaging notes, the PRD checklist for release docs, stable schema/migrations, and no known P1s. Nothing Phase 9 does should change app behavior — only how it ships.
