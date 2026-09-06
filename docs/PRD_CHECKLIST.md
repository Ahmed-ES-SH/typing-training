# PRD Compliance Checklist — Phase 8 exit audit

Walked against `PRD-Offline-Coding-Touch-Typing-Trainer.md` at Phase 8
close. Status key: **PASS** = evidenced below (test/file), **MANUAL** =
verified by hand on a dev run, **PHASE-9** = needs the installed package
(Wayland GUI run — no P1 suspected, procedure listed).

Full suite at audit time: **22 files / 188 tests green** (`pnpm test`),
`tsc --noEmit` clean, `pnpm build && pnpm perf:budget` PASS.

## §2 Core goals (all 12)

| # | Goal | Status | Evidence |
|---|---|---|---|
| 1 | Progressive full-keyboard teaching | PASS | 7 levels L1→L7, `src/content/curriculum.test.ts` shape suite; layout-agnostic keymap `src/lib/layout/` |
| 2 | ≥ 250 ready-made lessons | PASS | 260 lessons (26/35/50/48/42/37/22), `curriculum.test.ts` "has exactly the planned per-level counts" + `TOTAL_LESSONS ≥ 250` |
| 3 | Programming/code focus | PASS | L3 symbols, L5 vocabulary, L6 syntax, L7 real code (JS/TS/HTML/CSS/SQL/JSON/Bash/Git); §6.1 coverage suite (every symbol ≥ 3 lessons) |
| 4 | Real-time performance measurement | PASS | Engine `liveMetrics` (WPM/accuracy/error/backspaces/elapsed/completion), 200 ms tick; `metrics.test.ts`, `engine.test.ts`, `throughput.test.ts` |
| 5 | Complete attempt history | PASS | Append-only `lesson_attempts` ledger; §24 raw log + CSV; `repositories.test.ts`, `importExport.test.ts` |
| 6 | Progress first→final lesson | PASS | `progressService` (§12: totals, per-level, position, continue); `progressService.test.ts`; Dashboard hero + Statistics per-level mastery |
| 7 | Defined unlock level | PASS | Gate accuracy ≥ 95 AND WPM > 45, `rules.test.ts` PRD table (50/93 FAIL, 44/98 FAIL, 50/95 PASS, 46/97 PASS); never re-locks (`unlockIfLocked`) |
| 8 | Weak keys identified, training adapted | PASS | Analyzer → heatmap → adaptive injection → weakness drills; `analyzer.test.ts`, `heatmap.test.ts`, `adaptiveGenerator.test.ts`, `drillService.test.ts`, `weaknessService.test.ts` |
| 9 | Unlimited repetition of completed | PASS | Completed lessons replayable; bests only move forward (`mergeAttemptStats`); `progressService.test.ts` |
| 10 | Custom user-authored lessons | PASS | CRUD + drafts + practice + import/export; `domain` detection, `importExport.test.ts`, Custom Lessons screen |
| 11 | Fully offline | PASS | Vendored fonts/icons, compiled Tailwind, zero runtime network (audit: `docs/perf/PERF_BUDGET.md` §4); Tauri SQLite local |
| 12 | Lightweight & fast on Linux | PASS | Entry 183.5 KB gzip, 33,903 keys/s engine, index-backed hot queries; `docs/perf/PERF_BUDGET.md` |

## §6 Coverage / §7–§8 behavior

- PASS — §6.1 symbols/digits/capitals each in ≥ 3 lessons' `target_keys`
  (`curriculum.test.ts` "§6.1 symbol coverage"); L7 tagged across all 8 PRD
  languages. §7 states ✓/●/🔒 from `lesson_progress` (Lessons screen,
  session sidebar). §8 gate + no-relock covered above.

## §9–§12 Metrics & progress

- PASS — §9 seven live values (`LiveMetrics`); §10 append-only attempts
  with key reports; §11 per-lesson bests/progression; §12 overall + per-level
  + streak + recent/trend (`progressService`, `dailyService`).

## §13–§18 Features

- PASS — §13 adaptive injection (`adaptiveGenerator.test.ts`); §14 heatmap
  from real history only (`heatmap.test.ts`); §15 weakness queue + evolving
  drills (`drillService.test.ts`); §16 custom lessons (§2.10); §17
  Zod-validated JSON round-trips, malformed rejected
  (`importExport.test.ts`); §18 goals/tracking/streak/consistency
  (`dailyGoalsRepo.test.ts`, `dailyProgress.test.ts`,
  `dailyService.test.ts`, `useDailyGoalsStore.test.ts`).

## §20 Screens (all 8)

Dashboard, Lessons, Typing Session, Lesson Results, Statistics, Weakness
Training, Custom Lessons, Settings — all implemented from
`screens/*_typekernel` designs. Phase 8 additions: editable goals
(Settings → Training), met-state goals panel + 14-day strip (Dashboard),
90-day consistency row (Statistics), title-per-screen, focus rings,
screen-reader labels on icon-only buttons, loading/empty/error triads on
async surfaces.

## §21 Persistence / §24 history rule

- PASS — 8 §21 tables (+ Phase 6 rollups) via versioned migrations, WAL +
  FK, Zod-at-the-boundary (§23); backup envelope covers every table
  (`exporter.collectBackup`, restore-tested in `importExport.test.ts`).
- PASS — §24: raw ledger paginated (50/page) + full CSV export, charts
  never reduce history to bests (`useStatsStore`, Statistics screen).

## §26 Core user flow

Automated legs green (finish pipeline `progressService.test.ts`;
session store `useSessionStore.test.ts`; streak/goal legs above).
Remaining end-to-end GUI walkthrough on Wayland — filed as the Phase 9
packaging gate (procedure, not a finding):

1. `pnpm tauri build`, install, launch with network disabled.
2. Open → dashboard → lesson → session (live §9 metrics) → results →
   unlock → repeat; weakness drill evolves (`{ : ]` → `]`); custom lesson
   practiced; backup export → reset → import round-trip; goals set →
   train → bars fill → met-state; streak survives a goal-miss.
3. Keyboard-only: full session without a mouse (Enter resume, Esc back,
   Ctrl+R retry, Ctrl+K search, Tab order, focus rings).
4. State sweep: fresh DB, deleted DB file, corrupt import — no raw
   exceptions (triads in place on all async surfaces).

## Fix-or-file disposition

No PRD-scoped defects found in the sweep. Post-1.0 backlog (non-PRD,
not implemented): DVORAK/COLEMAK keymaps (keys ready, UI "coming soon"),
per-date goal-override editing UI (repo API shipped, no screen yet),
cold-start/RSS wall-clock on target hardware (instrumented, see
`docs/perf/PERF_BUDGET.md` §1).
