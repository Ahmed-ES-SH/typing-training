# PHASE 3 PLAN — Data Layer & Typing Engine

**Parent:** [MAIN_PLAN.md](./MAIN_PLAN.md) → Phase 3
**PRD sections covered:** §9 (Real-Time Monitoring), §19 (Keyboard Layout Support), §21 (Local Database + §21.1 relationships), §22 (Frontend State), §23 (Validation), §26 (session loop, save-attempt portion)
**Design reference:** `screens/current_lesson_typekernel/` (`code.html` + `screen.png`) — Typing Session screen with module sidebar, code buffer, live telemetry
**Depends on:** Phase 2 exit criteria met (shell, tokens, stub screens, fonts vendored, boilerplate gone)
**Status:** Planned — not started. Implementation contract for Phase 3 only; curriculum generation and the unlock rule are **Phase 4**.

---

## 1. Goal

Build the two foundations everything else stands on:

1. **Data layer** — SQLite via `tauri-plugin-sql` bridged to Drizzle ORM, with all 8 PRD tables (§21), idempotent migrations, and Zod-validated domain types (§23).
2. **Typing engine** — a pure, unit-testable TypeScript engine producing real-time metrics (§9), fed by a layout-agnostic QWERTY keymap (§19), wired through a zustand session store (§22) into the **Typing Session screen** implemented from the `current_lesson` design.

At the end of this phase a user can open a (fixture) lesson, type real code in the code-buffer UI, watch live WPM/accuracy/errors/progress update, finish the session, and have the attempt + per-key statistics persisted to SQLite.

**Explicitly out of scope (later phases):** lesson generators / 250-lesson curriculum (Phase 4), unlock rule + lesson states ✓/●/🔒 and Results screen (Phase 4), overall progress + charts (Phase 5), weakness/adaptive intelligence (Phase 6), custom lessons + import/export (Phase 7), daily goals logic (Phase 8 — table created now, unused).

---

## 2. Design Decisions (fixed before coding)

| Topic | Decision | Rationale |
|---|---|---|
| SQL bridge | `tauri-plugin-sql` (JS API) + **Drizzle `sqlite-proxy`** driver (`drizzle-orm/sqlite-proxy`) adapting `Database.select/execute` to Drizzle | Keeps PRD stack (both are already dependencies); no Rust-side query code to maintain |
| Migrations | `drizzle-kit generate` → versioned SQL files under `src-tauri/migrations/`, applied via `tauri_plugin_sql::Builder::add_migrations("sqlite:typing_trainer.db", ...)` with `include_str!` in `lib.rs` | Plugin runs migrations once per DB version inside Rust — idempotent by construction; SQL stays reviewable/diffable |
| Engine architecture | **Event-sourced pure TS**: `createSession(lesson)` → feed `InputEvent`s (`char`, `backspace`) → reducer returns immutable `SessionState`; no DOM, no timers, no Tauri inside the engine | Unit-testable without a browser; §9 metrics are pure derivations of state |
| WPM formula | Gross WPM = (total typed chars ÷ 5) ÷ elapsed minutes; accuracy = correct keystrokes ÷ total keystrokes; error rate = errors ÷ total keystrokes | Standard typing-test convention; matches PRD's WPM/Acc examples |
| Key stats granularity | One row per **character** (not physical key): `key` = expected char, `shift_required` bool — so `a` vs `A` and `(` vs `9` are distinct (§14 heatmap needs symbol-level truth) | §6.1 focus is symbols; physical-key rollup can be derived later |
| Newline handling | Lesson content contains real `\n`; engine treats Enter as the `\n` character; tabs/IME out of scope | Code content is multi-line (see `current_lesson` design) |
| New dependency | `vitest` (devDependency) for engine unit tests | No test runner is installed yet; engine is the first pure-logic module that demands one |

---

## 3. Tasks

### 3.1 Register SQL plugin & open the database (Rust + capability)
- `src-tauri/src/lib.rs`: add `tauri_plugin_sql` with the `sqlite` feature binding, register the migration set (§3.2), and expose `.manage` pool — replacing the placeholder builder from Phase 2.
- `src-tauri/capabilities/default.json`: add the plugin's permission (`sql:default`).
- DB file lives in the app data dir (`typing_trainer.db`); no absolute paths.
- **Verify:** app boots; `Database.load("sqlite:typing_trainer.db")` from the frontend succeeds; `PRAGMA journal_mode=WAL` enabled at startup for §25 performance.

### 3.2 Drizzle schema + migrations (all 8 PRD tables, §21)
Define in `src/lib/db/schema.ts` with `drizzle-orm/sqlite-core`, then `drizzle-kit generate` into `src-tauri/migrations/`:

| Table | Key columns (abridged) | Notes |
|---|---|---|
| `lessons` | `id` (text pk, e.g. `"l1-003"` / `"custom-uuid"`), `level` int, `order_index` int, `title`, `description`, `content` text, `target_keys` json, `tags` json, `source` (`builtin`/`custom`), `created_at` | Built-in lesson *metadata* rows get seeded in Phase 4 when generators exist; table + sync helper land here |
| `lesson_progress` | `lesson_id` pk/fk, `status` (`locked`/`available`/`completed`), `best_wpm`, `best_accuracy`, `lowest_error_rate`, `attempt_count`, `unlocked_at`, `completed_at`, `updated_at` | §21.1 Lesson → Progress; unlock state changes are Phase 4 |
| `lesson_attempts` | `id` int pk autoincrement, `lesson_id` fk, `attempt_number` int, `wpm` real, `accuracy` real, `error_rate` real, `error_count` int, `correct_chars`, `incorrect_chars`, `backspace_count`, `duration_ms`, `completed` bool, `started_at`, `finished_at` | §10 append-only — **no UPDATE of metric columns, ever**; index on `lesson_id` |
| `key_statistics` | `key` text, `shift_required` bool, `total_presses`, `correct_presses`, `incorrect_presses`, `avg_latency_ms`, `last_seen_at` — pk (`key`,`shift_required`) | §21.1 attempts → key statistics; feeds heatmap/adaptive/weakness (Phases 5–6) |
| `training_sessions` | `id` pk, `kind` (`lesson`/`weakness`/`custom`/`adaptive`), `lesson_id` nullable fk, `started_at`, `ended_at`, `duration_ms`, `chars_typed` | One row per app-level training session |
| `custom_lessons` | `id` uuid pk, `title`, `description`, `content`, `difficulty`, `target_keys` json, `target_symbols` json, `wpm_target` nullable, `accuracy_target` nullable, `created_at`, `updated_at` | §16 fields complete now so Phase 7 is pure UI |
| `daily_goals` | `date` text pk (ISO), `minutes_goal`, `lessons_goal`, `chars_goal` | §18 — populated/used in Phase 8 |
| `settings` | `key` text pk, `value` json, `updated_at` | §20 Settings screen persistence (Phase 7) |

- Indexes: `lesson_attempts(lesson_id)`, `lesson_attempts(finished_at)`, `lesson_progress(status)`.
- `drizzle-kit.config.ts` points at schema + output dir; migration SQL committed to the repo.
- **Verify:** fresh start creates all 8 tables + indexes (inspect via `sqlite3` CLI); second start performs zero migrations (idempotency).

### 3.3 Drizzle ↔ plugin bridge + repositories
- `src/lib/db/client.ts` — singleton: `Database.load` once, wrap in `drizzle-proxy`; expose typed `db`. Map the proxy's `method` (`get`/`all`/`run`/`values`) onto plugin `select`/`execute` results — this is the one fiddly file; include a smoke test query in dev.
- `src/lib/db/repositories.ts` (or per-entity files): `attemptsRepo.insert(...)`, `keyStatsRepo.recordBatch(events)` (single upsert transaction — batch all keystrokes of a finished session in one `INSERT ... ON CONFLICT` set, not per-keystroke round-trips), `progressRepo.get/update`, `sessionsRepo.*`.
- All repository inputs/outputs pass through Zod schemas (§3.4). Invalid data throws before touching SQL (§23: validation happens in the frontend layer since there is no backend).

### 3.4 Zod domain schemas (§23)
`src/lib/schemas.ts` (or `src/lib/domain/`): `LessonSchema`, `AttemptSchema`, `KeyStatEventSchema`, `SessionStateSchema`, `CustomLessonSchema`, `SettingsSchema`, `DailyGoalsSchema` + inferred TS types. These are the single source of truth shared by engine, repositories, and (later) import/export validation.

### 3.5 Layout-agnostic keymap (§19)
- `src/lib/layout/keymap.ts` — `KeyboardLayout` type: `rows: KeyDef[][]` where `KeyDef = { id, base, shift?, finger: Finger, width? }`; `Finger` union (`pinky-l` … `pinky-r`, `thumb`).
- `src/lib/layout/qwerty.ts` — full QWERTY US ANSI instance: number row with shift symbols (`!@#$%^&*()`), all three letter rows, punctuation; **including every §6 symbol** so the heatmap/session UI can place `{ } [ ] < > / \ | & * = + - _ : ; ' " \` ! ? @ # $ %`.
- `src/lib/layout/fingers.ts` — finger → label/color mapping for the visualization (colors from the TypeKernel palette).
- The engine and the on-screen keyboard component consume **only** this abstraction — zero hard-coded QWERTY elsewhere (§19 acceptance: a hypothetical layout swap requires only a new keymap file).

### 3.6 Typing engine (pure, §9)
`src/lib/engine/` :
- `types.ts` — `InputEvent = { type: "char", char } | { type: "backspace" } | { type: "enter" }`; `KeyPerformance = { expected, typed, correct, shiftRequired, latencyMs, at }`; `SessionState` (immutable snapshot: `position`, `entries` per-char status, live counters, `startedAt`, per-key events buffer).
- `engine.ts` — `createSession(content)` + `applyEvent(state, event, now)` reducer: marks current char correct/incorrect, advances on any key, backspace steps back and clears status, counts errors (a wrong char is an error and still advances, mirroring the design's inline error highlighting), accumulates `correctChars/incorrectChars/backspaceCount/totalKeystrokes`, records `KeyPerformance` per keystroke with inter-key latency.
- `metrics.ts` — pure selectors from state + elapsed: `wpm`, `accuracy`, `errorRate`, `progressPct`, `elapsedMs`. Live values = same functions called each tick (§9: nothing is computed only at the end).
- `engine.test.ts` + `metrics.test.ts` (vitest) — cover: empty session, perfect run, wrong-char advancement, backspace-then-retype, WPM/accuracy math against hand-computed values, progress %, latency capture, multi-line content with `\n`.

### 3.7 Session store (zustand, §22)
- `src/stores/useSessionStore.ts` — transient only: current lesson (from a fixture), engine state, timer (`setInterval` 200 ms tick recomputing live metrics — no per-keystroke re-render of the whole tree), `start/stop`, keystroke input handlers, and `finish()` which: persists `lesson_attempts` row, batches `key_statistics` upsert, closes the `training_sessions` row, then resets store.
- Persistence failures surface as a visible toast/error state — attempts are never silently dropped.
- Global keydown listener active only while a session is running; printable chars, Backspace, Enter handled; modifier combos (Ctrl+C etc.) pass through; Tab optional (insert spaces) — document the choice.

### 3.8 Typing Session screen (from `current_lesson_typekernel` design)
Implement `src/screens/TypingSessionScreen.tsx` replacing its stub, mirroring the design's structure:
- **Left sidebar** (`w-80…96`): track header (Level 03 // …, progress bar), filter tabs, scrollable module list with the design's card states — completed (`check_circle` + record), active (RUNNING with ping dot), next (`lock_open`), locked (`lock`) — **fixture data for now**, real states arrive with Phase 4.
- **Main buffer**: code area with line numbers; per-char spans rendered from engine state: typed-correct (`text-on-surface`), typed-incorrect (error bg per design), current char (blinking caret span), pending (`text-on-surface-variant`); monospace `code-lg`, real `\n` line breaks.
- **Live telemetry strip** (the design's 4-card grid): Drill WPM, Accuracy, elapsed, progress — plus backspace count and correct/incorrect chars (PRD §9 requires all seven live metrics; extend the design's cards minimally to fit them, e.g. two rows or compact chips, staying on-palette).
- **Keyboard visualization**: `<KeyboardVisualization>` component rendering the keymap from §3.5, highlighting the next expected key (and its shift partner when the expected char requires shift) — reused by Statistics heatmap in Phase 5.
- Session end state: minimal inline summary card (WPM/accuracy/duration + "saved ✓") — the full Results screen is Phase 4; a "Retry" action restarts the session.
- Footer/header stays consistent with Phase 2 TopBar; the screen fills the shell without page scroll (design uses fixed-height flex layout with internal scrolling sidebar).

### 3.9 Fixture lessons (development-only)
- `src/content/fixtures.ts` — 2–3 hand-written lesson objects (e.g. the design's `ctx->frame_buffer.pixel.alpha=0xFF;` struct-arrow module; a `{ : ] }` brace module) validated by `LessonSchema`, used by the session screen until Phase 4's generators land. Marked clearly as fixtures; not bundled into the shipped curriculum.

---

## 4. File Change Summary

| File | Change |
|---|---|
| `src-tauri/src/lib.rs` | Register `tauri_plugin_sql` + migrations (replaces Phase 2 placeholder builder) |
| `src-tauri/capabilities/default.json` | Add `sql:default` permission |
| `src-tauri/migrations/*.sql` | New — drizzle-kit generated, versioned |
| `drizzle-kit.config.ts` | New |
| `package.json` | Add devDependency `vitest`; add `db:generate` script |
| `src/lib/db/schema.ts` | New — 8 tables + indexes |
| `src/lib/db/client.ts` | New — sqlite-proxy bridge |
| `src/lib/db/repositories.ts` | New — attempts/keyStats/progress/sessions repos |
| `src/lib/schemas.ts` | New — Zod domain schemas (§23) |
| `src/lib/layout/keymap.ts`, `qwerty.ts`, `fingers.ts` | New — layout abstraction (§19) |
| `src/lib/engine/types.ts`, `engine.ts`, `metrics.ts`, `*.test.ts` | New — pure engine + tests (§9) |
| `src/stores/useSessionStore.ts` | New — transient session state (§22) |
| `src/components/KeyboardVisualization.tsx` | New — keymap-driven on-screen keyboard |
| `src/screens/TypingSessionScreen.tsx` | Stub → real implementation |
| `src/content/fixtures.ts` | New — dev fixtures |

---

## 5. Verification (phase exit criteria)

1. `pnpm vitest run` — engine/metrics tests green, including hand-computed WPM/accuracy cases and backspace/retype behavior.
2. Fresh boot migrates an empty DB to v1 with all 8 tables + indexes; reboot applies nothing (idempotency log check).
3. End-to-end: start fixture lesson → type the buffer (with deliberate errors + corrections) → live stats update every tick and match a manual calculation of WPM/accuracy/progress → finish → row exists in `lesson_attempts` with correct metrics, `key_statistics` reflects per-char correctness (inspect via `sqlite3`), `training_sessions` closed.
4. §9 completeness: during a session all seven live metrics (WPM, accuracy, error rate, correct/incorrect/total chars, backspace count, elapsed time, progress %) are visible and updating without waiting for session end.
5. §19 check: `grep -r "qwerty\|QWERTY" src --include="*.ts*" -l` returns only `src/lib/layout/` — no layout assumptions outside the keymap module.
6. Restart the app mid-nothing (no session) — no orphaned `training_sessions` rows; a force-quit mid-session leaves at most one unclosed session row, tolerated (documented behavior).
7. `pnpm tauri dev` + `pnpm build` clean; keystroke latency subjectively instant (no visible input lag at 60fps typing pace).
8. App remains fully offline (no new network dependencies introduced).

---

## 6. Handoff to Phase 4

Phase 4 expects from this phase: schema + repositories (it adds `lesson_progress` state transitions and the unlock rule), Zod `LessonSchema` (it feeds generated curriculum through it), the engine + session store (it wires real lessons into the session screen and adds the Results screen), and `KeyboardVisualization` (reused in Results/Statistics). Fixture lessons are deleted or demoted once generators supply real Level 1 lessons.
