# PHASE 5 PLAN — Progress Tracking & Statistics

**Parent:** [MAIN_PLAN.md](./MAIN_PLAN.md) → Phase 5
**PRD sections covered:** §12 (Overall Progress Tracking), §24 (Statistics and Charts), §20 (Dashboard + Statistics screens), §25 (performance guardrails for aggregates), §26 (Update Lesson Statistics / Analyze Weaknesses read-outs)
**Design references:** `screens/dashboard_typekernel/` and `screens/statistics_typekernel/` (`code.html` + `screen.png` — both authored for this project, token-exact)
**Depends on:** Phase 4 exit criteria met (260 seeded lessons, populated `lesson_progress`, attempts ledger with `key_report`, unlock flow working)
**Status:** Planned — not started. Implementation contract for Phase 5 only.

---

## 1. Goal

Turn the accumulated data into visible progress: a real **Dashboard** (overall progress, current lesson, recent attempts, streak, weak keys, quick access to weakness training) and a real **Statistics** screen (Recharts-powered WPM/accuracy history, per-lesson and per-attempt performance, curriculum progress, raw attempt log). §12's tracking values and §24's "raw history is never reduced to a best score" rule are the acceptance backbone.

At the end of this phase the two screens render live from SQLite, reconcile exactly with the DB, and handle both a brand-new user (empty states) and a long history (hundreds of attempts) within the §25 performance budget.

**Explicitly out of scope (later phases):** key heatmap section (Phase 6 — the statistics design's heatmap panel is reserved as a placeholder slot), weakness drill *content generation* (Phase 6 — the dashboard's drill card navigates but is marked "engine arrives in Phase 6"), daily-goal *editing/consistency view* (Phase 8 — dashboard goals panel shows computed actuals against seeded defaults only), custom lessons/settings (Phase 7).

---

## 2. Design Decisions (fixed before coding)

| Topic | Decision | Rationale |
|---|---|---|
| Aggregation layer | All §12 totals and chart series computed by **SQL aggregates** (`GROUP BY`, `AVG`, `MAX`) in a new `progressRepo`/`statsRepo`, never by loading the whole attempts table into JS | §25: history can reach thousands of rows; charts get pre-bucketed series |
| "Overall WPM/accuracy" definition | Lifetime mean over **completed** attempts, plus a "recent" figure = mean of the last 10 completed attempts (trend arrow = recent − lifetime) | §12 shows a single overall number; the design's "(+3.4%)" delta needs a comparison base |
| Chart series bucketing | Daily buckets (local time) for the range view: per-day mean WPM and best WPM; "session avg" line = per-attempt points (scatter/line), "daily avg" = bucketed mean — matching the design's two-line legend | §24 improvement-over-time; design shows both lines |
| Range selector | `30d / 90d / all / per-level` pills; `per-level` switches the WPM chart to a per-level bar chart | Design's pill row; per-level view doubles as "performance per lesson group" |
| §24 raw history rule | Attempt history table renders **every** attempt with server-side-style pagination (50/page, ordered by `finished_at DESC`) + CSV export of the full filtered set; no "best only" views anywhere | §24 verbatim; design shows `#642 → #637` raw log |
| Streak definition | Consecutive local days with ≥ 1 completed training session, counting today or ending yesterday (today alone doesn't break it); best streak stored in settings | Design's "12-day streak • best 21" |
| Dashboard goals panel | Computes today's actuals (minutes from `training_sessions`, lessons completed, chars typed) against `daily_goals` defaults seeded to 15 min / 3 lessons / 500 chars; goal *editing* UI stays Phase 8 | §18 is Phase 8; the design's panel is display-only |
| Weak keys radar | Top 5 chars by lowest accuracy from `key_statistics` with a minimum-sample threshold (`total_presses ≥ 30`); shared `weaknessService.selectWeakKeys()` — Phase 6 reuses the same selector for drill generation | Prevents one-off typos from masquerading as weakness |
| Empty states | First-run user sees: gauge at 0%, "no attempts yet" tables, drill card prompting first lesson — no NaN/undefined anywhere | PRD tracks "from the first lesson" |
| Chart theming | Recharts with TypeKernel tokens: stroke `#f97316`/`#ffb783`, grid `#31353f`, JetBrains Mono ticks via CSS, 95% accuracy gate as `ReferenceLine` | Design fidelity |
| Performance | Statistics screen lazy-loaded (`React.lazy`) — recharts leaves the startup bundle; aggregates cached in zustand per range until data changes | §25 startup budget |

---

## 3. Tasks

### 3.1 Progress aggregation service (§12)
- `src/lib/stats/progressService.ts` — SQL-backed selectors:
  - totals: lessons total (260), completed count, overall %, per-level completed/total (the design's `L3 14/50` rows);
  - position: current lesson (first `available` in curriculum order), last completed, highest unlocked;
  - workload: total attempts, lifetime WPM/accuracy + recent-10 trend (§2 table);
  - `continueFrom()` → `{ lessonId }` powering the Dashboard's resume card ("Current Lesson: 78 — …" per §12 example).
- Unit tests against a fixture DB seeded with a known attempt/progress state — every §12 field asserted, including the per-level breakdown format.

### 3.2 Streak & daily actuals
- `src/lib/stats/dailyService.ts` — streak (current + best, persisted `best_streak` in `settings`), today's minutes/lessons/chars from `training_sessions` + attempts, merged with `daily_goals` defaults.
- Local-timezone day boundaries (Linux desktop, single-user assumption documented).
- Test: synthetic session rows across a broken streak (e.g. Mon/Tue, gap, Thu/Fri) produce expected current/best streaks.

### 3.3 Weak-keys selector (feed for now, engine later)
- `src/lib/stats/weaknessService.ts` — `selectWeakKeys(limit, minPresses)` from `key_statistics`; returns sorted `{ key, shiftRequired, accuracy, presses, misses }`.
- Unit test: fixture stats → expected ordering; below-threshold keys excluded.
- (Phase 6 will extend this module with combo/pattern detection — its signature is designed to grow without breaking the Dashboard.)

### 3.4 Dashboard screen (from `dashboard_typekernel` design)
Replace `DashboardScreen.tsx` stub, section-by-section per the design:
- **Hero:** greeting + status chips; rolling stats strip (WPM +Δ%, accuracy +Δ%, lifetime keys typed, time today vs goal) — all wired to §3.1/3.2 services; right-side radial **mastery gauge** (SVG ring, overall %, "64 / 260 Mastered", tier label).
- **Active module card** (2/3 width): current lesson from `continueFrom()` — level/index line, title, last-attempt WPM + accuracy-vs-gate hint, content preview line (first content line, cursor block), best/attempts meta, primary **Resume Lesson (Enter)** button → Typing Session. Enter-key shortcut on the dashboard.
- **Daily Goals panel** (sidebar): 3 progress bars (time/lessons/chars) + streak line ("12 days • best 21") — display-only per §2.
- **Weakness Drill card** (sidebar): top weak-key chips (`{ : ] _`) from §3.3 + **Start Weakness Drill** button → navigates to Weakness Training screen (Phase 6 renders real content; button shows "engine arrives in Phase 6" hint if invoked before then — temporary, removed in Phase 6).
- **Recent Attempts table**: last 5 attempts (module, WPM, accuracy color-coded vs gate, errors, backspaces, PASS/FAIL chip, relative time) + "VIEW ALL →" → Statistics screen.
- **Weak Keys Radar card**: top-5 accuracy bars (color: error < 85%, secondary 85–93, primary ≥ 93 — design's thresholds) + 7-day WPM sparkline (Recharts mini area chart).
- Footer status line ("ALL SYSTEMS LOCAL…", DB size, last backup — backup value "—" until Phase 7).

### 3.5 Statistics screen (from `statistics_typekernel` design)
Replace `StatisticsScreen.tsx` stub (`React.lazy` loaded):
- **Hero:** title, aggregate chips (Best WPM + which lesson, avg accuracy, total attempts, total trained time), range pills (`30 DAYS / 90 DAYS / ALL TIME / PER LEVEL`).
- **WPM over time** (Recharts `ComposedChart`): per-attempt session line + daily-average dashed line, mono ticks, range-filtered; `PER LEVEL` mode → per-level mean bar chart.
- **Accuracy over time** (Recharts `LineChart`): accuracy line + `ReferenceLine` at 95% labeled "95% GATE", shaded below-gate region; footer stats (first-try pass rate from attempts).
- **Placeholder slot** for the Key Heatmap section (Phase 6) — bordered empty panel titled "Key Heatmap // arrives in Phase 6" so layout matches the design skeleton.
- **Attempt History // Raw Log**: paginated table (50/page) — #, module, WPM, acc, err, bksp, duration, result chip; `EXPORT CSV ↓` (full filtered set, client-side CSV build); per §24 nothing here reduces to "best score".
- **Per-Level Mastery sidebar**: the 7-level progress bars (design's L1–L7 rows) from §3.1.
- **Improvement Across Attempts** panel: bar chart of mean WPM by attempt-number bucket (1, 2, 3, 4, 5+) over lessons with ≥ N attempts + the design's "+14 median" style caption; raw per-attempt rows remain in the table above.
- Range changes re-query via `statsRepo`; series cached per range in `useStatsStore` (zustand) until attempts change.

### 3.6 Dev-only demo-data seeder (verification enabler)
- `src/lib/stats/demoSeed.ts` + dev-only "Generate demo history" debug button (gated by `import.meta.env.DEV`, stripped from production builds): generates ~600 realistic attempts across lessons/days (WPM/accuracy drift upward, weak `{`/`:` keys) so charts, streaks, radar, and pagination can be verified without hand-typing 600 sessions.
- Seeding uses the real repositories (no SQL shortcuts) — seeded data must reconcile exactly like real data.

### 3.7 `training_sessions` audit (§26 logging)
- Confirm Phase 3's `finish()` closes sessions for every path added in Phase 4 (retry, next-lesson, replay, abandon-with-ESC); add an abandon path: leaving an active session via navigation marks the session row `ended_at` with `completed=false` (attempt row is **not** written — partial typing is not an attempt, per §10 "every lesson start creates an attempt" applies to *finished* attempts; document this reading).
- Test: navigate away mid-session → session row closed, no attempt row, counters not polluted.

---

## 4. File Change Summary

| File | Change |
|---|---|
| `src/lib/stats/progressService.ts` + test | New — §12 aggregates |
| `src/lib/stats/dailyService.ts` + test | New — streaks, daily actuals |
| `src/lib/stats/weaknessService.ts` + test | New — weak-key selector (shared with Phase 6) |
| `src/lib/stats/demoSeed.ts` | New — dev-only demo history generator |
| `src/lib/db/repositories.ts` | Extend — grouped aggregates, paginated attempts, CSV projection |
| `src/stores/useStatsStore.ts` | New — cached aggregates/chart series per range |
| `src/stores/useSessionStore.ts` | Extend — abandon path closes `training_sessions` |
| `src/screens/DashboardScreen.tsx` | Stub → full implementation (dashboard design) |
| `src/screens/StatisticsScreen.tsx` | Stub → full implementation (statistics design, lazy-loaded) |
| `src/components/StatCard.tsx`, `MasteryGauge.tsx`, `Sparkline.tsx` | New — shared presentational pieces |
| `src/App.tsx` | Statistics route lazy-loaded |

---

## 5. Verification (phase exit criteria)

1. `pnpm vitest run` — §12 aggregate tests, streak tests (broken-streak fixture), weak-key selector tests green.
2. **Reconciliation sweep:** for a seeded history, every number on Dashboard and Statistics (totals, %, per-level rows, attempt counts, means, streak) equals a hand-written SQL query against the same DB — zero drift.
3. Charts render from the demo seed (600 attempts): WPM/accuracy lines show the seeded upward trend, daily-avg line tracks, 95% gate line draws, per-level bars match seeded distribution, improvement-by-attempt bars rise monotonically-ish as seeded.
4. §24 raw rule: pagination walks the full 600-row ledger page by page; CSV export contains all rows, not a summary.
5. Empty-state sweep: fresh DB (no attempts) — both screens render with 0/zero values, no NaN, no crashed chart; "no data" placeholders per design tone.
6. Range pills actually change the queried window (spot-check a date outside 30d disappears).
7. Performance (§25): with 600 seeded attempts, Statistics opens < 300 ms after first lazy load, Dashboard < 150 ms; switching ranges feels instant (cached); bundle check confirms recharts not in the startup chunk.
8. Mid-session abandon leaves no attempt row and closes the session row (DB check).
9. Visual checks against `dashboard_typekernel/screen.png` and `statistics_typekernel/screen.png` (heatmap slot shows the Phase 6 placeholder, not a fake heatmap).
10. `pnpm tauri dev` / `pnpm build` clean; offline audit still passes (no new network deps).

---

## 6. Handoff to Phase 6

Phase 6 expects: `weaknessService.selectWeakKeys()` (it becomes the adaptive analyzer's core, extended with combos/patterns), the reserved heatmap slot on Statistics + `KeyboardVisualization` (Phase 3) to render the real heatmap into, `key_statistics` accumulating real per-char data, and the dashboard drill card ready to swap its placeholder hint for real drill generation. Attempt history and `key_report` also feed Phase 6's repeated-error-pattern detection.
