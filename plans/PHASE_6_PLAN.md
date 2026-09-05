# PHASE 6 PLAN — Intelligence Features

**Parent:** [MAIN_PLAN.md](./MAIN_PLAN.md) → Phase 6
**PRD sections covered:** §13 (Adaptive Lessons), §14 (Key Heatmap), §15 (Weakness Training), §21.1 (attempts → key statistics → heatmap/adaptive/weakness), §26 (Analyze Weaknesses branch)
**Design reference:** `screens/weakness_training_typekernel/` (`code.html` + `screen.png`); heatmap legend/section from `screens/statistics_typekernel/`
**Depends on:** Phase 5 exit criteria met (weakness selector, stats services, heatmap placeholder slot on Statistics, real per-char `key_statistics` accumulating)
**Status:** Planned — not started. Implementation contract for Phase 6 only.

---

## 1. Goal

Build the three intelligence features that make the app adaptive rather than static:

1. **Key Heatmap (§14)** — visual keyboard colored strong/average/weak/frequently-incorrect from accumulated per-key performance, on the Statistics screen (filling the Phase 5 placeholder) and in a compact variant inside the typing session.
2. **Adaptive Lessons (§13)** — a weakness analyzer (frequently-wrong keys, difficult bigram combinations, repeated error patterns) that boosts weak characters/patterns in generated practice content.
3. **Weakness Training (§15)** — a dedicated mode auto-generating drill sessions from the weakest keys/symbols that **evolves** as weaknesses shrink (`{ : ]` → `: ]` → `]`), implemented as the Weakness Training screen per its design.

At the end of this phase the §21.1 pipeline is fully alive: attempts → key statistics (+ bigram/daily rollups) → heatmap + adaptive content + evolving drills.

**Explicitly out of scope:** custom lessons + import/export (Phase 7), settings UI for drill preferences (defaults used now, screen arrives Phase 7 — drill config itself is built here and persisted in `settings`), daily-goal interactions (Phase 8).

---

## 2. Design Decisions (fixed before coding)

| Topic | Decision | Rationale |
|---|---|---|
| New migration **v3** | (a) `bigram_statistics` table — `pair` text pk (e.g. `"->"`, `"::"`), `total`, `incorrect`, `avg_latency_ms`; (b) `key_statistics_daily` — (`date`, `key`, `shift_required`) pk with `presses`, `correct`; (c) `lesson_attempts`: add `kind` (`lesson`/`weakness`/`adaptive`) and make `lesson_id` nullable | §13 needs *combinations* and *repeated patterns* (time-windowed), but Phase 3's schema only answers lifetime per-char; §15's "rolling 30-day" queue and the design's recovery curves need daily history. Both are impossible to derive retroactively — must be recorded from now on |
| Daily rollup mechanics | At every `finish()`, upsert today's `key_statistics_daily` rows from the session's key events (one transaction with the attempt insert); `key_statistics` lifetime aggregates stay as-is | Cheap, exact, enables 30-day windows without a cron/background job (§25: no background processes) |
| Heatmap cell semantics | Each physical key cell is colored by **weighted accuracy across all chars typed on it** (base + shift variants, e.g. `[` and `{` both land on the `[` key); tooltip splits per-char (`[`: 96% · `{`: 78%); the four summary cards under the keyboard list actual **symbols** (`{ : [ / ;`) preserving symbol-level truth (§14: "both standard keys and programming symbols") | PRD requires symbol visibility *and* a keyboard view; per-physical-key color + per-char tooltip satisfies both without a second keyboard |
| Heatmap color buckets | `< 85%` weak, `85–93%`, `93–97%`, `≥ 97%` strong, no-data — exact palette from the statistics design (`#4a1d06 / #9d4300 / #d97722 / #ffb783`) | Design legend is the spec |
| Heatmap data window | 30-day rolling window by default (from `key_statistics_daily`), falling back to lifetime `key_statistics` when daily rows don't cover a char yet | §14 "based on real historical performance"; rolling window matches the design's "30-Day Accuracy" title |
| Weak-key lifecycle (§15) | Queue states: `targeted` (accuracy < 90% over rolling 30d, min presses) → `maintenance` (accuracy ≥ 90% for 7 consecutive days, design's "graduated • kept in maintenance pool") → `eliminated` (≥ 95% for 7 days). Max 6 concurrent targeted keys; priorities = worst accuracy first | Implements the design's queue cards and PRD §15's evolving set (`{ : ]` → `: ]` → `]`) with deterministic, testable thresholds |
| Drill composition | Weak chars injected at **weight ×3** (configurable 1–5) inside real code-identifier contexts drawn from a curated context corpus (identifiers, params, JSON-ish lines — the design's `ctx->frame_buffer` style); session = 5 sets × 120 keystrokes (design's "SET 3 OF 5", "120 keys"); non-weak chars sampled from the user's typed history to keep the rest realistic | §13 "increases the appearance of weak characters/patterns"; the design's numbers become the spec |
| Adaptive lesson type (§13) | `adaptiveGenerator.ts` produces a lesson-shaped object (`kind: 'adaptive'`) — a ~60-second practice block emphasizing weak keys/bigrams — surfaced (a) as the Weakness screen's main drill and (b) as an "Adaptive Practice" card on the Dashboard replacing the Phase 5 placeholder hint | §13 is about future exercises generally, not only the dedicated mode; the Dashboard card already promises this |
| Drill persistence | Drills save `lesson_attempts` rows with `kind`/`lesson_id` (nullable) + `training_sessions` with `kind='weakness'|'adaptive'`; drill metrics do **not** touch `lesson_progress` or unlock gates (drill target: WPM ≥ 30 display-only, per design) | Keeps §8 curriculum gating pristine; attempts ledger stays one unified history |
| Bigram detection | Bigrams counted from the *expected* content stream (planned pairs), errors attributed to the pair when either char of the pair is mistyped while inside it | "Difficult key combinations" = transition difficulty, not just char difficulty |
| Regenerate action | The design's REGENERATE button re-runs the generator with a new seed (deterministic per `(queueState, setIndex, seed)`) | Reproducible for tests, still varied for users |

---

## 3. Tasks

### 3.1 Schema migration v3 + event capture
- `src-tauri/migrations/0003_intelligence.sql`: create `bigram_statistics`, `key_statistics_daily`; alter `lesson_attempts` (add `kind`, drop NOT NULL on `lesson_id`); indexes on `key_statistics_daily(date)`, `bigram_statistics(total DESC)`.
- Extend the Phase 3 key-event buffer → `finish()` writes: lifetime upserts (existing), today's daily rollup, bigram rollups (expected-pair stream) — all in the single existing transaction.
- Register migration v3 in `lib.rs`; idempotency check on reboot.

### 3.2 Weakness analyzer (extends Phase 5 `weaknessService`)
- `analyzeWeaknesses()`: rolling-30d per-char accuracy (from `key_statistics_daily`), per-char latency percentiles (lifetime), bigram error ranking, repeated-error-pattern detection (same char missed ≥ 3 times across the last 10 attempts via `key_report`), and queue lifecycle transitions per §2 thresholds (writes queue state to `settings` json — no new table needed).
- Output shape: `{ targets: [{ key, shiftRequired, accuracy, presses, misses, priority, state }], combos: [{ pair, errorRate }], patterns: [...] }` — the single input to the heatmap cards, adaptive generator, and drill composer.
- Unit tests with synthetic daily-rollup fixtures: ordering, threshold edges (89.9 → targeted, 90.0 × 7 days → maintenance), max-6 queue cap, maintenance → elimination after 7 days.

### 3.3 Adaptive generator (§13)
- `src/lib/intelligence/adaptiveGenerator.ts` — takes analyzer output → lesson-shaped drill: weak chars at configured weight, weak bigrams embedded in context (e.g. `->` appears inside real-looking accessor chains), contexts sampled from a curated corpus filtered by the user's curriculum position (Level ≥ 3 contexts use symbols realistically).
- Deterministic given `(analysis, seed)`; property tests: expected-char frequency ≈ configured weight ratio, no empty drills, all content passes `LessonSchema`.

### 3.4 Weakness training mode (§15)
- `src/lib/intelligence/drillService.ts` — session lifecycle: build 5 sets from the generator, run each set through the **Phase 3 engine** unchanged, per-set stats, set-advance logic, `focusKeyHits` counter (design's "61/72, 9 misses on `{`"), abort/regenerate handling.
- Drill attempts persist via the extended attempts repo (`kind: 'weakness'`); `training_sessions.kind='weakness'`.
- Drill config (session length, symbol weight, word context, backspace policy — the design's 4 rows) persisted in `settings` (defaults per design); no UI to edit them until Phase 7's Settings screen.
- Tests: set sequencing, focus-hit accounting, persistence kind, config defaults.

### 3.5 Key heatmap (§14)
- `src/lib/intelligence/heatmap.ts` — maps analyzer data onto the **Phase 3 keymap** (§19 abstraction pays off: `layout.charsOnKey(char)` resolves every stats char to a physical cell), computes per-cell weighted accuracy + per-char splits + no-data cells; window parameter (30d/lifetime).
- `src/components/KeyHeatmap.tsx` — full keyboard per the statistics design (rows, widths, legend, four summary cards: Frequently Incorrect / Below Average / Strong / Slowest-latency). Pure presentational: data in → colored cells out.
- **Statistics screen:** replaces the Phase 5 placeholder slot; window follows the screen's range pills where meaningful (30d/90d/all).
- **Typing session:** compact `KeyHeatmapCompact` variant (same cells, smaller, no cards) toggled from the session sidebar — highlights weak keys during practice per MAIN_PLAN.
- Tests: mapping completeness (every §6 symbol lands on a valid cell), bucket boundaries (84.9/85/93/97), weighted merge of shift pairs.

### 3.6 Weakness Training screen (from `weakness_training_typekernel` design)
Replace `WeaknessTrainingScreen.tsx` stub:
- **Queue sidebar** (per design): "Target Elimination Queue // AUTO-GEN" with per-key cards (glyph, name, accuracy badge + bar, exposures/misses, PRIORITY n), graduated keys (maintenance pool / eliminated, dimmed), evolution chain (`{ : ] _` → `: ] _` → `]`), and the 4-row **Drill Configuration** block (read-only until Phase 7).
- **Main drill area:** header ("DRILL {n} // GENERATED FROM YOUR DATA", `FOCUS: { : ]`, `SET 3 OF 5`, REGENERATE), title ("Brace, Colon & Bracket Isolation" — generated from target families), ×3-frequency description, **code buffer** reusing the Phase 3 session rendering with weak chars error-tinted *before* typing (they're the targets), 4 stat cards (Drill WPM vs ≥ 30 target, Accuracy vs last set, Focus Key Hits x/y, Elapsed + set counter).
- **Target Recovery Curves** (Recharts multi-line): 30-day accuracy per queued key from `key_statistics_daily`, with per-key labels; evolution rows underneath ("improving +1.2%/day — elimination ETA 9 days", projections from linear regression on the daily series — display-only estimates).
- Flow: Start/continue drill → per-set typing (engine) → set summary → next set → final summary persists drill attempt; ESC returns to dashboard.
- Screen is lazily loaded (recharts + generator stay out of startup bundle, §25).

### 3.7 Integrations & cleanup
- **Dashboard:** the weakness drill card becomes functional — chips from live queue, button starts a weakness session; the "engine arrives in Phase 6" hint is removed.
- **Lessons screen:** symbol-latency telemetry strip (Phase 4) now also reflects drill data — no change needed beyond verification.
- **Session screen:** compact heatmap toggle added; no other session changes.
- Empty states: no data at all → queue shows "complete a few lessons to detect weaknesses", heatmap shows all no-data cells; single-lesson history → daily curves fall back to lifetime values (documented in tooltips).

---

## 4. File Change Summary

| File | Change |
|---|---|
| `src-tauri/migrations/0003_intelligence.sql` | New — `bigram_statistics`, `key_statistics_daily`, `lesson_attempts.kind` + nullable `lesson_id` |
| `src-tauri/src/lib.rs` | Register migration v3 |
| `src/lib/db/schema.ts`, `repositories.ts` | Extend — new tables + batched rollup writes in `finish()` |
| `src/lib/intelligence/analyzer.ts` (+test) | New — weakness analysis + queue lifecycle (§13/§15 detection) |
| `src/lib/intelligence/adaptiveGenerator.ts` (+test) | New — weighted drill/lesson generation (§13) |
| `src/lib/intelligence/drillService.ts` (+test) | New — multi-set drill sessions (§15) |
| `src/lib/intelligence/heatmap.ts` (+test) | New — keymap mapping + bucketing (§14) |
| `src/components/KeyHeatmap.tsx`, `KeyHeatmapCompact.tsx` | New — heatmap views |
| `src/screens/WeaknessTrainingScreen.tsx` | Stub → full implementation (weakness design) |
| `src/screens/StatisticsScreen.tsx` | Heatmap slot → real heatmap |
| `src/screens/TypingSessionScreen.tsx` | Add compact heatmap toggle |
| `src/screens/DashboardScreen.tsx` | Drill card → functional |
| `src/stores/useSessionStore.ts` | Extend — drill session mode |
| `src/lib/stats/weaknessService.ts` | Refactor — delegates to analyzer (Phase 5 signature preserved) |

---

## 5. Verification (phase exit criteria)

1. `pnpm vitest run` — analyzer threshold/lifecycle tests (targeted → maintenance → eliminated, queue cap), generator property tests (weight ratio ≈ ×3, schema-valid output, determinism per seed), heatmap mapping/boundary tests, drill service tests (set flow, focus-hit accounting) all green.
2. **Simulated-data end-to-end (PRD acceptance):** seed synthetic key stats where `{` and `:` are weak, `]` borderline, `_` healthy → heatmap colors match the legend exactly; queue shows `{ :` targeted, `]` maintenance, `_` absent; generated drill over-samples `{`/`:` ≈ 3× and includes a weak bigram in context.
3. **Evolution test (§15):** simulate 14 days of improving daily rollups → queue UI progression `{ : ] _` → `: ] _` → `]` with recovery-curve lines rising and ETA estimates updating.
4. Real-flow check: complete lessons with deliberate mistakes on specific symbols → after a few attempts those symbols appear in the queue and in the next generated drill's focus; complete a drill → `lesson_attempts` row with `kind='weakness'`, `training_sessions` closed, curriculum progress untouched.
5. Heatmap on Statistics fills the former placeholder (30d/lifetime switch works); compact heatmap toggle works in-session without stealing keystroke focus.
6. Performance (§25): `finish()` latency with rollups < 50 ms for a 120-key drill (single transaction, measured); analyzer runs on navigation, not per keystroke; Weakness screen lazy-loaded.
7. Offline audit: generator corpus and all intelligence logic are local — no network, no model downloads.
8. `pnpm tauri dev` / `pnpm build` clean; visual check of the Weakness screen against `weakness_training_typekernel/screen.png` and the heatmap against the statistics design legend.

---

## 6. Handoff to Phase 7

Phase 7 expects: drill configuration keys already defined in `settings` (its Settings screen just adds editing UI for them), `adaptiveGenerator` able to validate arbitrary user content through the same `LessonSchema` pipeline, the queue/lifecycle state format (its data-management backup must include it), and the Dashboard's drill card conventions. The unified attempts ledger (lesson + weakness + adaptive kinds) is what Phase 7's progress backup must round-trip losslessly.
