# PHASE 4 PLAN — Curriculum & Lesson System

**Parent:** [MAIN_PLAN.md](./MAIN_PLAN.md) → Phase 4
**PRD sections covered:** §2 (250+ lessons), §6 (7-level curriculum + §6.1 symbol focus), §7 (Lesson Access System ✓/●/🔒), §8 (Unlock Requirements), §10 (Lesson Attempts), §11 (Lesson Statistics), §26 (flow: finish → calculate → save → check unlock → unlock/repeat)
**Design references:** `screens/all_lessons_typekernel/` (Lessons screen), `screens/lesson_results_typekernel/` (Results screen)
**Depends on:** Phase 3 exit criteria met (schema + repositories, engine, session store, Typing Session screen with fixtures)
**Status:** Planned — not started. Implementation contract for Phase 4 only.

---

## 1. Goal

Replace the Phase 3 fixtures with a real, bundled, **260-lesson progressive curriculum** (≥ 250 per PRD §2) produced by curated generator scripts; wire the **unlock rule** (accuracy ≥ 95 **AND** WPM > 45 in the same attempt, permanent unlock, §8) into the session flow; persist attempt numbering and per-lesson statistics (§10, §11); and implement the two remaining curriculum screens — **Lessons** (curriculum directory) and **Lesson Results** — from their designs.

At the end of this phase the core PRD loop (§26) works end-to-end: Dashboard → Lessons → pick an available lesson → type → results → pass unlocks next / fail loops back → repeat completed lessons freely.

**Explicitly out of scope (later phases):** overall-progress dashboard + charts (Phase 5), heatmap/adaptive/weakness intelligence (Phase 6 — this phase only *feeds* them key data), custom lessons UI + import/export (Phase 7), daily-goal logic (Phase 8).

---

## 2. Design Decisions (fixed before coding)

| Topic | Decision | Rationale |
|---|---|---|
| Lesson totals per level | **L1: 26, L2: 35, L3: 50, L4: 48, L5: 42, L6: 37, L7: 22 → 260 total** | Matches the counts baked into the approved designs (all_lessons hero "260 modules", statistics "L1 26/26 … L7 0/22"); satisfies PRD ≥ 250 |
| Content pipeline | Generators are **plain TS modules in `src/content/`** exporting lesson arrays (deterministic, no build step, bundled by Vite); a **vitest validation suite** asserts count ≥ 250, unique IDs, level distribution, and §6.1 coverage | "Local JSON/TypeScript resources" per PRD §4/§21; committing generated JSON separately would add a stale-artifact risk for zero benefit |
| Lesson IDs | `l{level}-{3-digit index}` (e.g. `l3-014`); custom lessons keep `custom-{uuid}` (Phase 7) | Stable, human-readable, matches the design's "MODULE 3.14" display convention (`L{level} • {index}`) |
| Unlock gate constants | `ACCURACY_GATE = 95` (≥), `WPM_GATE = 45` (**>** — exactly 45.0 fails), plus `completed === true` | §8 table verbatim: 50/93 FAIL, 44/98 FAIL, 50/95 PASS, 46/97 PASS |
| Re-lock prevention | `lesson_progress.status` only ever moves `locked → available → completed`; downgrade is not an exposed operation in any repo function | §8 "once unlocked, stays unlocked" enforced at the data layer, not by convention |
| First-available rule | After seeding, the very first lesson (`l1-001`) is `available`; everything else `locked` | §7 current/available semantics |
| Attempt numbering | `MAX(attempt_number) + 1` per lesson, computed inside the insert transaction | §10 example shows monotonic attempts per lesson |
| Results grade scale | S: pass + WPM ≥ 65 & acc ≥ 98 · A: pass + WPM ≥ 55 & acc ≥ 97 · B: pass + WPM ≥ 50 · C: pass (any) · D: fail with acc ≥ 90 · F: everything worse — displayed as the design's `GRADE S` badge | The design shows a grade; PRD only defines pass/fail, so grading is presentational and cannot affect unlocking |
| Per-attempt key spotlight | New migration **v2**: add `key_report` json column to `lesson_attempts` (top problem chars: expected, misses, avg latency, final status) written at `finish()` | The Results design renders per-key spotlight cards ("Pointer Member Operator (`->`) · 114ms"); global `key_statistics` can't answer "what happened in *this* attempt" |
| Content editing | Lesson `content` may be revised in later releases; on seed-upsert, existing lesson rows' progress/attempts are keyed by `id` and are never touched | Replay history survives curriculum tweaks |

---

## 3. Tasks

### 3.1 Content architecture + Level 1–2 generators
- `src/content/types.ts` — generator input/output types (`LessonDraft`, `LevelSpec`), reusing `LessonSchema` from Phase 3 for output validation.
- `src/content/levels/level1.ts` (26 lessons — keyboard fundamentals): home-row drills (asdf jkl;), top row, bottom row, individual-key isolation, two-key combos (adjacent + jump pairs), finger-anchor exercises, basic words/sequences. Every lesson lists `target_keys`.
- `src/content/levels/level2.ts` (35 — numbers): single digits, row sweeps, combinations, sequences (numeric IDs, dates, versions like `2.1.0`, IPs, hex), digit+symbol mixes from the number row.
- Generators are deterministic (no RNG without a fixed seed) so output is stable across builds.

### 3.2 Level 3–7 generators (the programming core)
- `level3.ts` (50 — **programming symbols**, the §6-heavy level): grouped into families — bracket pairs `( ) { } [ ] < >`, quotes `' " \``, operators `= + - * / \ | & %`, shift-number symbols `! @ # $ % ^`, punctuation `: ; _ ? . ,` — each family gets isolation drills, mix drills, and symbol-in-identifier-context drills (e.g. `ctx->frame_buffer`, `items.map(...)`, `std::sync::Arc`).
- `level4.ts` (48 — shift & capitalization): uppercase letters/words, shift-letter+symbol combos, capitalized identifiers, `camelCase`, `PascalCase`, `snake_case`, `kebab-case`, `SCREAMING_SNAKE_CASE` mixing drills.
- `level5.ts` (42 — vocabulary): the PRD §6 word list (`function`, `variable`, `return`, `class`, `interface`, `object`, `array`, `async`, `await`, `import`, `export`, `const`, `let`, `type`, `string`, `number`, `boolean`, …) as word drills, then in short phrases.
- `level6.ts` (37 — syntax patterns): `if (...) {}`, `for (...) {}`, `while`, `function example() {}`, `const value = ...;`, `object.property`, `array[index]`, `items.map(...)`, `try {} catch {}`, `async function ...`, arrow functions, ternaries, template literals.
- `level7.ts` (22 — real code): progressively realistic snippets in JavaScript, TypeScript, HTML, CSS, SQL, JSON, Bash, and Git commands (per PRD §6), each tagged with its language in `tags`.
- `src/content/index.ts` — assembles `Curriculum` (ordered levels → lessons), validates every lesson against `LessonSchema` at module load (fail-fast in dev), exposes `getLesson(id)`, `lessonsByLevel`.

### 3.3 Curriculum validation suite (PRD §2, §6.1 enforcement)
- `src/content/curriculum.test.ts` (vitest):
  - total count ≥ 250 (target 260) and per-level counts match the spec table exactly;
  - unique IDs, monotonic `order_index` per level, non-empty content, `LessonSchema` validity for all 260;
  - **§6.1 coverage test:** a fixture asserting every symbol in `( ) { } [ ] < > / \ | & * = + - _ : ; ' " \` ! ? @ # $ %` plus `0–9` and A–Z appears in at least N lessons' `target_keys` (N ≥ 3);
  - every L7 lesson tagged with one of the 8 PRD languages.
- Run in CI-equivalent local verification; a failing coverage test blocks the phase.

### 3.4 Seeding & progress initialization
- `src/lib/curriculum/seed.ts` — at app startup (after Phase 3 migrations): idempotent upsert of all lesson rows (`lessons` table, `source: 'builtin'`), then initialize `lesson_progress` rows: first lesson `available`, rest `locked`; existing rows untouched.
- Handles new-lesson insertion (new ids appear as `locked`) and content revision (update `content`/metadata, keep progress).
- Reuses the Phase 3 sqlite bridge; seed runs in one transaction.

### 3.5 Unlock rule + progress service (§8, §7)
- `src/lib/curriculum/rules.ts` — pure `evaluateAttempt({ completed, accuracy, wpm }): "PASS" | "FAIL"` + `GATES` constants + `gradeFor(attempt)`.
- `rules.test.ts` — **the PRD §8 table verbatim**: 50 WPM/93% → FAIL, 44/98 → FAIL, 50/95 → PASS, 46/97 → PASS; boundary cases 45.0 WPM → FAIL, 94.9% → FAIL, exactly 95% → PASS.
- `src/lib/curriculum/progressService.ts` — `completeAttempt(lessonId, metrics, keyReport)`:
  1. insert attempt with `attempt_number = MAX+1` (transactional);
  2. update `lesson_progress` best-stats (best WPM, best accuracy, lowest error rate, attempt count) — §11;
  3. if PASS: mark lesson `completed` (set `completed_at`, keep `unlocked_at`), and set the **next lesson in curriculum order** to `available` (only if currently `locked` — never touch `completed`/`available` rows: re-lock prevention);
  4. return `{ pass, grade, nextLessonId | null }` for the Results screen.
- Unit tests with an in-memory fixture DB (or repository seam): multi-attempt progression — FAIL, FAIL, PASS unlocks next; replaying a completed lesson never changes later-lesson states; best-stats monotonicity.

### 3.6 Lessons screen (from `all_lessons_typekernel` design)
Replace `LessonsScreen.tsx` stub; load curriculum + progress into a client-side store (`useCurriculumStore`, derived state — no duplication of DB truth):
- **Hero banner:** "Curriculum & Syllabus Directory" title block, rolling stats strip (WPM/accuracy from attempts history), radial **mastery gauge** (overall completed %, "X / 260 Mastered", progress bar) — per design.
- **Control bar:** search input (filters by title, tag, target key/symbol — client-side over the in-memory curriculum), status filter pills with live counts (`All / Completed / Active / Available / Locked`), level dropdown, view toggle (grid/list).
- **Level sections:** expandable headers per design (badge, title, completion %, speed/accuracy/module stats); the *active engagement* level expanded by default with its clearance-criteria banner ("Must sustain ≥ 95% Accuracy & ≥ 45 WPM…").
- **Module cards** in grid: mastered (record WPM/acc + **Replay Drill**), active/available (last attempt + **Resume/Start Module**), locked (dimmed, requirement hint "Requires ≥ 95% on L3-013"); click behavior per §7 — completed/available start a session, locked does nothing visible.
- **Symbol latency telemetry strip** (bottom): per-symbol latency bars from `key_statistics` (`-> :: &mut <T> {}` style chips per design); hidden entirely when insufficient data (graceful empty state).
- Data displayed comes from `lesson_progress` + attempts aggregates — matches DB exactly (§7 trust).

### 3.7 Results screen (from `lesson_results_typekernel` design)
Replace `LessonResultsScreen.tsx` stub; route state (via `useSessionStore`/params) carries the finished attempt:
- Header breadcrumb: `Track {level} • Module {index} | {title}` + `Session ID: #{attempt_number}`.
- Verdict block: "Requirement Satisfied — **Lesson Passed**" (or failure variant, error-tinted per design's error palette) + **GRADE** badge; on pass, "Next unlocked: Module X • {title}" line.
- Metric cards with **threshold deltas**: Typing Speed (WPM + "+23.4 above gate"), Accuracy (vs 95%), Time Elapsed (vs expected), Mistakes & Fixes (error count / backspaces).
- **Key spotlight cards** from the attempt's `key_report` (worst chars with latency/miss notes) — the design's `->` / `*` cards.
- **Actions with keyboard shortcuts:** `Esc` → Lessons, `Ctrl+R` → Retry Lesson, `Enter` → Next Lesson (only when pass + next exists); plus the SQLite-synced/streak footer line (streak value static until Phase 8).
- Note: this design file uses a few raw hex/slate classes instead of tokens — implement with the nearest TypeKernel tokens (§ Phase 2 theme), not new one-off colors.
- Comparison with previous attempts (PRD §20 Results bullet): a compact "attempt history" strip (last N attempts of this lesson: WPM/acc/result) — present in the design's ledger area; raw data from `attemptsRepo`.

### 3.8 Flow wiring (§26 core loop)
- `useSessionStore.finish()` now calls `progressService.completeAttempt(...)` and navigates to Results with the outcome.
- Lessons screen "Resume/Start/Replay" → starts a session with that lesson → Typing Session → Results → Next/Retry/Esc loops back.
- `useUiStore` gains typed navigation params for `lesson-results` (attempt id) and `typing-session` (lesson id) — extending, not rewriting, the Phase 2 store.
- Delete `src/content/fixtures.ts` (or keep behind a dev flag only if the engine test-suite references it — prefer migrating tests to generated L1 lessons).

---

## 4. File Change Summary

| File | Change |
|---|---|
| `src/content/types.ts`, `index.ts` | New — curriculum assembly + validation |
| `src/content/levels/level1.ts … level7.ts` | New — 260 lessons (26/35/50/48/42/37/22) |
| `src/content/curriculum.test.ts` | New — count/coverage/schema tests (§2, §6.1) |
| `src/content/fixtures.ts` | Deleted (tests migrated) |
| `src/lib/curriculum/rules.ts` + test | New — unlock gate + grade (§8) |
| `src/lib/curriculum/progressService.ts` + test | New — attempt insert, best-stats, unlock transition (§10, §11) |
| `src/lib/curriculum/seed.ts` | New — idempotent lesson seeding + progress init |
| `src-tauri/migrations/0002_attempt_key_report.sql` | New — `key_report` json column on `lesson_attempts` |
| `src-tauri/src/lib.rs` | Register migration v2 |
| `src/stores/useCurriculumStore.ts` | New — curriculum + progress view state |
| `src/stores/useSessionStore.ts` | Extend — finish() → progressService → Results navigation |
| `src/screens/LessonsScreen.tsx` | Stub → full implementation (all_lessons design) |
| `src/screens/LessonResultsScreen.tsx` | Stub → full implementation (lesson_results design) |
| `src/lib/db/repositories.ts` | Extend — attempt-number transaction, best-stats update, next-lesson lookup |

---

## 5. Verification (phase exit criteria)

1. `pnpm vitest run` — curriculum tests (260 lessons, §6.1 coverage, schema validity) and rules tests (§8 table + boundaries) green; progressService tests prove FAIL→FAIL→PASS unlocks exactly one next lesson and replays never re-lock.
2. End-to-end §26 loop on real generated lessons: Lessons → start `l1-001` → type → Results (pass) → next lesson shows `available` on the Lessons screen; deliberately fail a later lesson → stays `available`, retry works; replay a completed lesson → record improves, later lessons unaffected.
3. Attempt ledger: three runs of one lesson produce attempts #1/#2/#3 with correct per-attempt metrics and key_report (§10 example shape).
4. Per-lesson stats (§11) on the Lessons screen cards match SQLite values exactly (best WPM/acc, attempts count).
5. Lessons screen visual check against `screens/all_lessons_typekernel/screen.png` (hero + gauge, pills, level sections, card states, telemetry strip empty-state) and Results against `lesson_results_typekernel/screen.png` (verdict, grade, deltas, spotlights, shortcuts).
6. Search + every filter pill returns correct counts against the seeded DB.
7. `pnpm tauri dev` / `pnpm build` clean; app still fully offline.

---

## 6. Handoff to Phase 5

Phase 5 expects: seeded 260-lesson `lessons` + fully-populated `lesson_progress` (its per-level breakdown reads both), the attempts ledger with `finished_at` + grades (its WPM/accuracy-over-time charts and attempt-history table), `key_statistics` accumulating from real sessions (its heatmap groundwork), and `useCurriculumStore` for the Dashboard's progress card. Results screen already renders attempt comparison — Phase 5 adds the long-term charts around it.
