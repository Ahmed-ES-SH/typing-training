# PHASE 7 PLAN — Custom Lessons, Import/Export, Settings

**Parent:** [MAIN_PLAN.md](./MAIN_PLAN.md) → Phase 7
**PRD sections covered:** §16 (Custom Lessons), §17 (Import/Export), §20 (Custom Lessons + Settings screens), §23 (Validation — "invalid imported data must never corrupt the local database")
**Design references:** `screens/custom_lessons_typekernel/` (Module Forge), `screens/settings_typekernel/` (System Configuration)
**Depends on:** Phase 6 exit criteria met (engine, drill config keys in `settings`, `LessonSchema` pipeline, unified attempts ledger)
**Status:** Planned — not started. Implementation contract for Phase 7 only.

---

## 1. Goal

Complete the user-facing feature set: full **custom lesson** authoring (create/edit/delete/practice, §16), local **JSON import/export** for custom lessons, collections and progress backups with strict Zod validation (§17 + §23), and the **Settings screen** wiring every preference the app has accumulated (layout, appearance, training, statistics, data management, application behavior — §20) into the `settings` table.

At the end of this phase the app is functionally complete per PRD §27; only daily-training polish (Phase 8) and packaging (Phase 9) remain.

**Explicitly out of scope:** daily-goal *editing* stays here only if trivial — no: goal editing is **Phase 8** (Phase 8 plan §3.2); performance/polish (Phase 8); packaging (Phase 9). Keyboard layouts beyond QWERTY remain "coming soon" (§19 scope: architecture only).

---

## 2. Design Decisions (fixed before coding)

| Topic | Decision | Rationale |
|---|---|---|
| New dependency | `@tauri-apps/plugin-dialog` + Rust `tauri-plugin-dialog` (file open/save pickers) and `@tauri-apps/plugin-fs` restricted to the user-chosen paths (scoped permissions) | §17 requires real local file I/O; browser `<input type=file>` works for import, but **export** needs a save dialog + write — a Tauri plugin is the correct offline-native route; capabilities scoped to picked paths only |
| Custom lessons & curriculum | Custom lessons live **outside** the §8 unlock chain — practicing one creates `kind='custom'` attempts and never touches `lesson_progress` of built-in lessons; they get their own best-WPM/accuracy markers on their cards | §16 is a practice outlet; §7/§8 govern the built-in curriculum only; design's cards show PB + attempt count, not ✓/🔒 |
| Draft state | Custom lessons have `is_draft` flag: drafts appear under the "Drafts (3)" filter, are excluded from practice counts until published ("Create & Drill" publishes + starts) | The design explicitly shows Drafts (3) and a "Save Draft" button |
| Target-key detection | On content change, derive `target_keys`/`target_symbols` by mapping every distinct char through the Phase 3 keymap (`shift_required` included); user-editable chips can add/remove; detection re-runs only when user hasn't manually edited | Design: "Target Keys / Symbols (auto-detected, editable)" + "17 target keys detected" counter |
| Custom lesson gates | Optional `wpm_target`/`accuracy_target` (0 = none, per §16 "optional") affect only the Results screen's personal threshold line and card badges — never a lock | §16 "optional targets"; no new gating system |
| Export format | Versioned envelope `typekernel.export.v1` (Zod discriminated union): `kind: "custom-lessons" \| "collection" \| "progress-backup"`; backups carry schema-versioned progress, attempts (incl. `key_report`), key stats + daily rollups, custom lessons, settings, daily goals | §17 "portable, human-readable, validatable, versionable, manually editable"; forward-compatible migrations import older `vN` by transforming up |
| Import semantics | `custom-lessons`/`collection` = **merge** (id collision → keep newer `updated_at`, or rename-on-import choice dialog); `progress-backup` = **replace-all** behind typed confirmation; imports are **atomic** — validated fully into memory before the first write, any Zod failure rejects the entire file with a path-accurate error list | §23 "must never corrupt the database"; half-imported backups are the corruption vector |
| Where validation lives | Shared `src/lib/io/exportSchema.ts` — the same Zod schemas used by the DB layer (Phase 3) composed into envelope schemas; export writes what import reads | Single source of truth; no drift between writer and reader |
| Theme variants | All three design themes ship: TypeKernel Dark (default), Terminal Mono, High Contrast — implemented as `@theme` token override classes (tokens are CSS vars since Phase 2); accent-intensity slider maps to a `--accent-alpha` variable consumed by glow shadows | Design lists all three; CSS-var architecture makes them cheap |
| Statistics preferences | New settings section (design nav has the item): default stats range (30d/90d/all), heatmap window (30d/lifetime), telemetry-strip visibility on Lessons | PRD §20 "statistics preferences"; closes the design's dangling nav item |
| Strict mode | Shown **LOCKED** (design: `GATE` + `LOCKED` chip) — §8 thresholds are product law and not user-configurable | §8 defines the unlock contract; the design itself marks it locked |
| Reset flow | "Reset…" opens confirm dialog requiring typed `RESET`; performs WAL checkpoint → delete DB file → re-run migrations → re-seed curriculum; optional pre-reset auto-export offer | §20 data management; irreversible action needs ceremony |

---

## 3. Tasks

### 3.1 Custom lessons CRUD + screen (§16, from `custom_lessons_typekernel` design)
Replace `CustomLessonsScreen.tsx` stub:
- **Hero:** "Module Forge" title block + `Import JSON` / `Export All` / `New Lesson` actions.
- **List:** search (title/tag/target key), filter pills with counts (All / Practiced / Drafts / Imported), card grid per design — source badge (`CUSTOM // YAML`, `CUSTOM // SQL`, `IMPORTED // COLLECTION`), PB + attempts, 1-line content preview, target-key chips, difficulty; actions **Practice / Edit / Delete** (delete confirms; imported collections expand to per-module practice).
- **Create/Edit form (right sidebar per design):** title*, description, content* (monospace textarea, live "247 characters • 6 lines" counter + "17 target keys detected"), difficulty + syntax-family selects, auto-detected editable target chips, **WPM Target / Accuracy Target sliders** (0 = none), live `SCHEMA VALID ✓` indicator (Zod, debounced), Save Draft / Create & Drill.
- Store `useCustomLessonsStore`; repos: `customLessonsRepo` (CRUD + draft toggle + PB lookups). Practicing routes into the existing session flow with `kind='custom'`.
- `customLessonsRepo` tests: CRUD, draft lifecycle, id-collision merge rule.

### 3.2 Export (§17)
- `src/lib/io/exporter.ts` — builds envelope payloads from repos: custom lessons only, a collection (selected ids), or full progress backup (progress, attempts, key stats, daily rollups, bigram stats, custom lessons, settings, daily goals, queue state); JSON pretty-printed with envelope version + exported-at timestamp + app version.
- Save dialog → write via scoped fs; filename convention `typekernel-<kind>-<date>.json`.
- Test: round-trip fixture — export envelope parses and validates against the import schemas byte-for-byte semantically.

### 3.3 Import + validation gate (§17 + §23)
- `src/lib/io/importer.ts` — open dialog → read → `EnvelopeSchema.safeParse` (discriminated by `kind` + version) → version migration chain (`v0/v1 → current`, forward-only) → **pre-import report dialog** (what will be added/replaced) → atomic transaction writes.
- Failure path: malformed/invalid JSON → error dialog listing Zod issues with JSON paths; **zero DB writes** on any failure (asserted by test: failed import leaves row counts identical).
- Tests: valid round-trip, wrong kind, tampered metric types, unknown version (rejected, not guessed), merge collision rules, atomicity on mid-file invalid data.

### 3.4 Settings screen (§20, from `settings_typekernel` design)
Replace `SettingsScreen.tsx` stub; left nav + sections per design:
- **Keyboard Layout:** QWERTY active (radio cards), Dvorak/Colemak visibly "keymap ready • coming soon" (disabled); finger-guides and highlight-next-key toggles (already consumed by Phase 3 components — now actually wired); reference-offset select (US ANSI / ISO / 60% — affects symbol hints only).
- **Appearance:** theme radio pills (3 themes, instant switch), accent-intensity slider (live), editor font select (JetBrains Mono bundled; Fira/Cascadia options disabled "not bundled" — offline rule), reduce-motion toggle (kills pulses/glow/blink app-wide via a `data-motion` root attribute).
- **Training Preferences:** Strict mode row (GATE/LOCKED display per design), backspace policy (Counted/Free/Forbidden — feeds the engine's backspace counting mode), adaptive-lessons toggle (gates Phase 6 generator injection), daily-goal display (values editable in Phase 8 — shown read-only with pointer), sound feedback toggle (system bell, no audio assets).
- **Statistics:** default range, heatmap window, telemetry-strip visibility (consumed by Phase 4/5 screens).
- **Data Management:** Export backup / Import backup cards (wired to §3.2/3.3, showing last-backup timestamp — the Dashboard footer starts reading real values now) + danger zone Reset with typed confirmation.
- **Application Behavior:** launch behavior (Dashboard / Current Lesson / Last Screen), "Check for Updates" (manual-only, opens release URL via opener plugin — the app never phones home, §5), version/build info line.
- `useSettingsStore` hydrated from the `settings` table at boot; every control persists immediately (debounced) and survives restart — no separate save button (design shows none).

### 3.5 Schema/dependency wiring
- Register `tauri-plugin-dialog` (+ scoped fs) in `lib.rs` and capabilities; add npm packages; document the exact permission scope in `src-tauri/capabilities/README.md`.

---

## 4. File Change Summary

| File | Change |
|---|---|
| `src/screens/CustomLessonsScreen.tsx` | Stub → full implementation (Module Forge design) |
| `src/screens/SettingsScreen.tsx` | Stub → full implementation (settings design) |
| `src/lib/io/exportSchema.ts` | New — versioned envelope Zod schemas (§23) |
| `src/lib/io/exporter.ts`, `importer.ts` (+tests) | New — §17 flows |
| `src/lib/db/repositories.ts` | Extend — customLessonsRepo, settings bulk read/write |
| `src/stores/useCustomLessonsStore.ts`, `useSettingsStore.ts` | New |
| `src/styles.css` | Theme override classes + `--accent-alpha` + reduce-motion hooks |
| `src-tauri/src/lib.rs`, `capabilities/default.json` | dialog + scoped fs plugin/permissions |
| `package.json` | `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs` |
| `src/components/` | Form primitives (Slider, ToggleRow, RadioCard, SectionCard) shared by settings + custom form |

---

## 5. Verification (phase exit criteria)

1. **Round-trip:** export full backup → wipe DB (reset) → import → every screen identical to pre-export (lesson progress, attempts, key stats, custom lessons, settings, streak) — the §27 "progress backups" promise.
2. **Invalid-import never corrupts (§23):** fuzz matrix (truncated JSON, wrong types, unknown version, mixed kinds) → all rejected with readable errors, DB row counts byte-identical before/after.
3. Custom lesson lifecycle: create → detected targets match content chars → Save Draft → appears under Drafts → publish → practice → attempt recorded `kind='custom'` → PB shows on card → edit → delete confirms and removes (attempts for it retained in ledger, documented).
4. Optional targets: lesson with WPM target 60 shows personal threshold on Results; 0-target lesson hides it; no unlock side-effects on built-in curriculum (§7 intact).
5. Settings: every control persists across app restart; theme switch re-skins instantly; reduce-motion visibly disables pulse/glow/blink; backspace policy change observable in next session's metrics.
6. Visual checks against `custom_lessons_typekernel/screen.png` and `settings_typekernel/screen.png` (including the danger-zone styling and locked strict-mode row).
7. Offline: export/import via native dialogs works with network disabled; "Check for Updates" is the only network touch, manual-only.
8. `pnpm tauri dev` / `pnpm build` / `pnpm vitest run` clean.

---

## 6. Handoff to Phase 8

Phase 8 expects: settings store pattern (daily-goal editing reuses it), dashboard backup/footer values now real, the export envelope (its consistency report may join backups), and every screen built — the polish pass audits what exists, not stubs.
