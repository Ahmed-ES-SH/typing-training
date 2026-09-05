# MAIN_PLAN — Offline Coding Touch Typing Trainer ("TypeKernel")

**PRD reference:** [PRD-Offline-Coding-Touch-Typing-Trainer.md](../PRD-Offline-Coding-Touch-Typing-Trainer.md)
**Stack:** Tauri 2 · React · TypeScript · Vite · Tailwind CSS 4 · Zustand · SQLite (tauri-plugin-sql) · Drizzle ORM · Zod · Recharts · pnpm

---

## Design Direction — "TypeKernel" Design System

The app implements the **TypeKernel design system** already established in `screens/`: dark orange-on-dark Material-3-style palette, Inter (UI) + JetBrains Mono (code/stats), Material Symbols icons, and a shared custom Tailwind token config (`surface-container-*`, `primary-container #f97316`, `space-*` spacing scale, `code-*` / `label-*` / `headline-*` / `display-*` type scale, small radii).

Every screen follows the repo convention: **one folder per screen under `screens/`, containing `code.html` (Tailwind-styled design mockup) + `screen.png` (rendered design image)**. Each screen in the React app is implemented from its design file, with the PNG as the visual acceptance reference.

### Design inventory & mapping (PRD §20)

| # | Screen (PRD §20)        | Design folder                          | Status |
|---|-------------------------|----------------------------------------|--------|
| 1 | Lessons (curriculum)    | `screens/all_lessons_typekernel/`      | ✅ code.html + screen.png |
| 2 | Typing Session          | `screens/current_lesson_typekernel/`   | ✅ code.html + screen.png |
| 3 | Lesson Results          | `screens/lesson_results_typekernel/`   | ✅ code.html + screen.png |
| 4 | Dashboard               | `screens/dashboard_typekernel/`        | ⬜ to design |
| 5 | Statistics + Key Heatmap| `screens/statistics_typekernel/`       | ⬜ to design |
| 6 | Weakness Training       | `screens/weakness_training_typekernel/`| ⬜ to design |
| 7 | Custom Lessons          | `screens/custom_lessons_typekernel/`   | ⬜ to design |
| 8 | Settings                | `screens/settings_typekernel/`         | ⬜ to design |

**Offline compliance note:** the design mockups load Inter / JetBrains Mono / Material Symbols from Google CDN and Tailwind from `cdn.tailwindcss.com` — acceptable for reference mockups, but the shipped app must bundle fonts and icons locally and use the compiled Tailwind 4 pipeline (already installed via `@tailwindcss/vite`).

---

## Phase 1 — Design System & Screen Designs (PRD §20)

- [ ] Create the 5 missing screen designs (Dashboard, Statistics + Key Heatmap, Weakness Training, Custom Lessons, Settings), each as `screens/<name>_typekernel/code.html` using the same token config + `screen.png` rendered from it. After this, **all 8 screens have both an HTML code file and a design image**.
- [ ] Extract the shared Tailwind token config (colors, spacing, typography, radii) into the app's Tailwind 4 `@theme` tokens so designs translate 1:1 into React.
- [ ] Self-host fonts (Inter, JetBrains Mono) and vendor the icon font locally for the app; map Material Symbols to Lucide React where a component icon is more appropriate.
- **Verify:** all 8 `screens/*_typekernel/` folders contain `code.html` + `screen.png`; tokens are identical across designs.

## Phase 2 — Architecture & App Shell (PRD §4, §22, §25)

- [ ] Remove boilerplate (greet command, demo assets/CSS); establish structure: `src/lib` (engine, db, layout), `src/stores` (zustand), `src/screens` (8 screens), `src/components`, `src/content` (lessons), `src-tauri`.
- [ ] App shell per TypeKernel designs: fixed top status bar (traffic dots, "TAURI v2 OFFLINE" badge, live WPM, avatar), zustand-based screen navigation (no extra router dep).
- [ ] Self-hosted fonts + vendored icons; dark theme only.
- **Verify:** `pnpm tauri dev` runs on Linux; shell matches design language.

## Phase 3 — Data Layer & Typing Engine (PRD §9, §19, §21, §22, §23)

- [ ] SQLite via `tauri-plugin-sql` + Drizzle ORM (`sqlite-core` schema, `sqlite-proxy` driver bridging the plugin); drizzle-kit migrations applied idempotently at startup.
- [ ] Tables: `lessons`, `lesson_progress`, `lesson_attempts`, `key_statistics`, `training_sessions`, `custom_lessons`, `daily_goals`, `settings` (§21), honoring §21.1 relationships (lesson → progress → attempts; attempts → key statistics → heatmap/adaptive/weakness).
- [ ] Layout-agnostic QWERTY keymap module (§19): rows, fingers, shift-pairs, symbol positions — consumed by the engine and keyboard visualization; future layouts = new keymap file.
- [ ] Pure, unit-testable typing engine (§9): char-by-char evaluation, live WPM, accuracy, error rate/count, correct/incorrect chars, backspace count, elapsed time, completion %; keystroke events feed key statistics.
- [ ] Zustand session store for transient state only (§22); persistent history in SQLite. Zod schemas for all domain types (§23).
- [ ] **Typing Session screen** from `current_lesson_typekernel` design: module sidebar with ✓/●/🔒 states, code buffer with current-char highlight, live telemetry.
- **Verify:** engine unit tests; session runs end-to-end with correct live stats.

## Phase 4 — Curriculum & Lesson System (PRD §2, §6, §7, §8, §10, §11, §26)

- [ ] Curated generator scripts under `src/content/` producing bundled JSON:
  - L1 Keyboard Fundamentals (home/top/bottom rows, fingers, combos, basic words)
  - L2 Numbers 0–9, combinations, sequences
  - L3 Programming Symbols — heavy dedicated coverage of all §6-listed symbols `( ) { } [ ] < > / \ | & * = + - _ : ; ' " \` ! ? @ # $ %`
  - L4 Shift & Capitalization — uppercase, shift combos, camelCase / PascalCase / snake_case / kebab-case
  - L5 Programming Vocabulary — `function`, `return`, `class`, `interface`, `async`, `await`, `import`, `const`, `type`, etc.
  - L6 Programming Syntax — `if (...) {}`, `for (...) {}`, `const value = ...`, `array[index]`, `items.map(...)`, `try {} catch {}`, etc.
  - L7 Real Code — JavaScript, TypeScript, HTML, CSS, SQL, JSON, Bash, Git commands
  - **Target: 250+ lessons**, with a coverage test asserting every §6.1 element appears.
- [ ] Unlock rule (§8): pass requires accuracy ≥ 95 **AND** WPM > 45 in the same attempt; unlocked lessons stay unlocked forever (never re-lock); next lesson unlocks on pass.
- [ ] Lesson states ✓ Completed / ● Current / 🔒 Locked (§7); full curriculum always visible; completed lessons repeatable unlimited times.
- [ ] Attempt persistence (§10): every attempt appended, never overwritten — WPM, accuracy, error rate/count, correct/incorrect chars, backspaces, duration, timestamp, completion status.
- [ ] Per-lesson statistics (§11): best WPM, best accuracy, lowest error rate, attempt count, progression, unlock status.
- [ ] **Lessons screen** from `all_lessons_typekernel` design: hero banner + mastery gauge, search, status filter pills, level sections with expand/collapse, module cards with replay/resume/locked states, symbol latency telemetry strip.
- [ ] **Results screen** from `lesson_results_typekernel` design: pass/fail, unlock result, full metrics, comparison with previous attempts.
- **Verify:** unlock-rule unit tests incl. the PRD table (50/93 FAIL, 44/98 FAIL, 50/95 PASS, 46/97 PASS); simulated multi-attempt progression; Level 1 playable end-to-end.

## Phase 5 — Progress Tracking & Statistics (PRD §12, §24, §20)

- [ ] Overall progress (§12): total/completed lessons, overall %, per-level breakdown ("L3 27/50"), current lesson, last completed, highest unlocked, total attempts, overall WPM/accuracy; "continue from current position" action.
- [ ] **Dashboard screen** (new design): progress hero, current-lesson card, recent attempts, streak, weak keys, weakness-training quick access.
- [ ] **Statistics screen** (new design) + Recharts (§24): WPM over time, accuracy over time, performance per lesson, improvement across attempts, curriculum progress; raw attempt history table always accessible — never reduced to a "best score".
- [ ] Training session logging into `training_sessions`.
- **Verify:** charts render from seeded attempt data; dashboard numbers reconcile with DB.

## Phase 6 — Intelligence Features (PRD §13, §14, §15, §26)

- [ ] Per-key statistics accumulation from every attempt (standard keys + programming symbols) → `key_statistics`.
- [ ] **Key Heatmap (§14):** visual keyboard colored strong/average/weak/frequently-incorrect from real historical performance only — on Statistics screen and in typing session.
- [ ] **Adaptive Lessons (§13):** weakness analyzer (frequently-wrong keys, difficult combos, repeated error patterns) boosts weak characters/patterns in future exercises.
- [ ] **Weakness Training screen** (new design): dedicated mode auto-generating sessions from weakest keys/symbols, evolving as weaknesses shrink (`{ : ]` → `: ]` → `]`).
- **Verify:** simulated attempt data produces expected heatmap colors and evolving weakness sessions.

## Phase 7 — Custom Lessons, Import/Export, Settings (PRD §16, §17, §20, §23)

- [ ] **Custom Lessons screen** (new design): create/edit/delete/practice with title, description, content, difficulty, target keys/symbols, optional WPM/accuracy targets (§16); stored in SQLite.
- [ ] **Import/Export (§17):** JSON export/import of custom lessons, lesson collections, and progress backups; **all imports Zod-validated before acceptance — invalid data never touches the DB** (§23); versioned, human-readable format.
- [ ] **Settings screen** (new design): keyboard layout (QWERTY now, keymap-ready), appearance, training preferences, statistics preferences, data management (backup/restore/reset), application behavior; persisted in `settings`.
- **Verify:** export→import round-trip; malformed JSON rejected with clear error; settings persist across restarts.

## Phase 8 — Daily Training, Performance & Polish (PRD §18, §25)

- [ ] **Daily Training (§18):** optional goals (e.g., 15 min / 3 lessons / 500 chars), daily time/lessons/characters tracking, streaks and consistency on Dashboard; complements the curriculum.
- [ ] **Performance pass (§25):** fast startup, lazy-loaded screens/charts, instant key response, indexed DB queries, no background processes, no network.
- [ ] UX polish: keyboard-only navigation, empty/error states, monospace code rendering.
- **Verify:** full §26 user-flow walkthrough; PRD requirement checklist audit.

## Phase 9 — Packaging & Distribution (PRD §3, §5, §27)

- [ ] TypeKernel branding, app icon, window + bundle config in `tauri.conf.json`.
- [ ] Build **AppImage** and Arch **`.pkg.tar.zst`**; test installed launches on Arch (Wayland primary, X11 spot-check); AUR PKGBUILD scaffold (later).
- [ ] **Offline audit (§5):** full functionality with network disabled.
- **Verify:** installed package completes a lesson; offline audit passes.

---

## Execution Order & Dependencies

Phases are sequential 1 → 9. The design system (1) and shell (2) gate all UI work; the engine (3) gates curriculum (4), which gates progress/stats (5) and intelligence (6); custom lessons/settings (7), daily training + polish (8), then packaging (9). Each phase ends with its verification step green before moving on. Every screen is implemented in React from its `screens/*/code.html` design, with `screen.png` as the visual acceptance reference.

**User decisions recorded:**
- Lesson content: curated generator scripts (not hand-authored).
- Deliverable: this plan saved as `plans/MAIN_PLAN.md`, then start building from Phase 1.
