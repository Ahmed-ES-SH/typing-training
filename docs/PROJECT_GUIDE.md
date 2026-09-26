# TypeKernel — Complete Project & Architecture Guide

> **Target Audience:** LLM agents starting a new session, developers, and maintainers.  
> **Purpose:** Provide an exhaustive, single-source-of-truth technical overview of the TypeKernel codebase, including product goals, architecture, database schemas, engine mechanics, directory breakdown, and development invariants.

---

## 1. Executive Summary & Product Goals

**TypeKernel** is an offline-first, native desktop application engineered specifically for **programmers to master touch-typing on code and developer syntax**. 

Unlike conventional touch-typing tutors that train on prose or literature, TypeKernel focuses on the unique mechanical demands of software engineering:
- Heavy use of punctuation, brackets, braces, and operators: `{}`, `[]`, `()`, `<>`, `=>`, `&&`, `||`, `!=`, `;`, `::`, `->`, `@`, `$`, `%`, etc.
- Mixed capitalization paradigms: `camelCase`, `PascalCase`, `snake_case`, `SCREAMING_SNAKE_CASE`, and `kebab-case`.
- Language keywords, semantic identifiers, and real-world multi-language code snippets (JS, TS, HTML, CSS, SQL, JSON, Bash, Git).
- Strict, unlock-gated progression to guarantee muscle memory before advancing.
- Deep, attempt-level analytics and adaptive weakness training that detects struggling keys and bigrams and generates targeted drills.

### Core Product Guarantees
1. **100% Offline-First:** Zero backend, zero telemetry, zero accounts, zero cloud dependencies. No runtime network requests.
2. **Local Persistence:** Fully backed by a local SQLite database in WAL mode using versioned migrations.
3. **Immutable History:** Attempt metrics are append-only. The app never overwrites historical attempt metrics with "best scores".
4. **Deterministic Progression:** 260 curated lessons across 7 progressive levels. Unlocking requires passing both speed and accuracy thresholds simultaneously in a single attempt.
5. **Adaptive Intelligence:** Automatic tracking of per-key accuracy, latency, and bigram error rates, feeding visual heatmaps and dynamic weakness drill generators.
6. **Keyboard-First Workflow:** Every screen action is reachable from the home row — global `Ctrl+K` palette, `Alt+1..6` / vim `g …` screen jumps, Smart Enter on Results, Zen mode, and 1-click micro-drills (UX plan Phases 1–6, shipped 2026-09-26).

---

## 2. Technical Stack & Tooling

| Component | Technology | Role / Details |
|---|---|---|
| **Desktop Shell** | **Tauri v2** (Rust 2021) | Native OS integration, window lifecycle, single-instance lock, file dialogues, and native SQLite driver bridge. |
| **Frontend Framework** | **React 19** + **TypeScript 5.8** | Component rendering, hooks, type safety (`strict: true`). |
| **Build Tooling** | **Vite 7** | Fast HMR in dev and production bundle optimization. |
| **Styling & Theme** | **Tailwind CSS v4** (`@tailwindcss/vite`) | TypeKernel dark theme system: orange accent (`#f97316`), Material-3 style container surfaces, Inter (UI) & JetBrains Mono (code). |
| **State Management** | **Zustand 5** | Lightweight reactive stores for transient state (live session telemetry, screen routing, daily goals, preferences). |
| **Data Layer & ORM** | **SQLite** + **Drizzle ORM** | Schema definition (`sqlite-core`), type-safe queries, migration generation (`drizzle-kit`), executed via `tauri-plugin-sql`. |
| **Validation & Schemas** | **Zod 4** | Runtime validation contracts at all I/O and database boundaries (lessons, attempts, imports/exports, settings). |
| **Charts & Analytics** | **Recharts 3** + Custom SVG | WPM/Accuracy trendlines, key latency distributions, key heatmaps, consistency heat strips. |
| **Icons & Fonts** | **Lucide React** + Self-hosted Fonts | Local offline font files (Inter, JetBrains Mono) and SVG icons. |
| **Test Suite** | **Vitest 5** + **Cargo Test** | Unit and integration tests for engine, curriculum, database repos, adaptive algorithms, and Rust backend. |
| **Packaging** | **AppImage**, **Pacman `.pkg.tar.zst`**, **AUR** | Native Linux desktop packaging for Arch and standard distributions. |

---

## 3. Directory & File Structure

```
typing-trainer/
├── .vscode/                     # Editor configurations
├── docs/                        # Project documentation & audits
│   ├── perf/                    # Performance budgets and audit logs
│   │   └── PERF_BUDGET.md       # Memory, bundle size, and throughput limits
│   ├── release/                 # Release procedures and verification matrices
│   │   ├── RELEASE_CHECKLIST.md # Step-by-step release checklist
│   │   ├── offline-audit.md     # Proof of 100% offline compliance
│   │   └── platform-verification.md # Linux / Wayland / X11 test records
│   ├── PRD_CHECKLIST.md         # PRD compliance tracking sheet
│   └── PROJECT_GUIDE.md         # THIS FILE: Master technical guide for developers and LLMs
├── packaging/                   # Packaging scripts and metadata
│   ├── arch/                    # Arch Linux PKGBUILD and desktop integration files
│   └── aur/                     # AUR submission checklist and template
├── plans/                       # Implementation plans & status tracking
│   ├── MAIN_PLAN.md             # Master roadmap (Phases 1–9)
│   ├── PHASE_2_PLAN.md .. PHASE_9_PLAN.md
│   ├── UX_PERFECTION_WORKFLOW_PLAN.md  # Full-app UX workflow redesign — Phases 1–6 ✅ done (2026-09-26)
│   ├── GAMIFICATION_AND_POLISH_PLAN.md # Audio/particles/game-feel (complementary, unstarted)
│   └── SIMPLIFY_DESIGN_SYSTEM_PLAN.md  # Design-system simplification
├── public/                      # Static assets bundled with the app (fonts, icons)
├── screens/                     # Reference UI designs & HTML mockups for all 8 screens
│   ├── all_lessons_typekernel/
│   ├── current_lesson_typekernel/
│   ├── custom_lessons_typekernel/
│   ├── dashboard_typekernel/
│   ├── lesson_results_typekernel/
│   ├── settings_typekernel/
│   ├── statistics_typekernel/
│   └── weakness_training_typekernel/
├── scripts/                     # Utility scripts
│   └── perf-budget.mjs          # Automated build & bundle size budget auditor
├── src/                         # React / TypeScript Application Source
│   ├── components/              # Shared UI components
│   │   ├── CommandPalette.tsx   # Ctrl+K omnibar: lesson search, screen jumps, actions
│   │   ├── ConsistencyStrip.tsx # 14-day / 90-day activity consistency heatmap strip
│   │   ├── FormPrimitives.tsx   # Custom inputs, toggles, textareas, buttons
│   │   ├── FrontierHud.tsx      # Sticky "Resume Frontier" bottom bar on Lessons
│   │   ├── GlobalHotkeys.tsx    # Mounts once in App.tsx: all global chords + palette/sheet overlays
│   │   ├── GoalRing.tsx         # Daily-goal radial rings: rAF mount sweep + met glow/check (§5.3)
│   │   ├── KeyHeatmap.tsx       # Full interactive QWERTY visual heatmap
│   │   ├── KeyHeatmapCompact.tsx# Condensed heatmap widget (in-session glance)
│   │   ├── KeyboardVisualization.tsx # Live interactive virtual keyboard during sessions
│   │   ├── LevelMilestoneModal.tsx # "Level N Mastered" celebration card
│   │   ├── LevelMiniMap.tsx     # Right-side level jump rail (L1..L7)
│   │   ├── MasteryGauge.tsx     # Radial circular progress gauge
│   │   ├── Modal.tsx            # Accessible modal shell: focus trap, Esc, stacked-overlay ownership
│   │   ├── NavSidebar.tsx       # Collapsible navigation sidebar
│   │   ├── Shell.tsx            # Main application layout wrapper
│   │   ├── ShortcutsModal.tsx   # `?` keyboard cheat-sheet dialog
│   │   ├── Sparkline.tsx        # Inline mini trend SVG
│   │   ├── SparklineChart.tsx   # Recharts-based telemetry chart
│   │   ├── StatCard.tsx         # Standardized KPI summary card
│   │   └── TopBar.tsx           # Status bar + macOS traffic dots (real Tauri window controls) + Ctrl+K hint
│   ├── content/                 # 260-Lesson Curriculum & Level Generators
│   │   ├── levels/              # Individual level generators
│   │   │   ├── level1.ts        # L1: Fundamentals (Home, Top, Bottom rows)
│   │   │   ├── level2.ts        # L2: Numbers & Digit combinations
│   │   │   ├── level3.ts        # L3: Programming Symbols & Operators
│   │   │   ├── level4.ts        # L4: Shift keys & Case naming conventions
│   │   │   ├── level5.ts        # L5: Programming Vocabulary & Keywords
│   │   │   ├── level6.ts        # L6: Syntax Patterns & Control Structures
│   │   │   └── level7.ts        # L7: Real Code (JS, TS, HTML, CSS, SQL, JSON, Bash, Git)
│   │   ├── build.ts             # Generator compilation utilities
│   │   ├── curriculum.test.ts   # Curriculum validation & coverage test suite
│   │   ├── index.ts             # Curriculum registry and accessor helpers
│   │   └── types.ts             # Level metadata and lesson structure interfaces
│   ├── lib/                     # Core Business Logic, Engine, DB, and Utilities
│   │   ├── cn.ts                # Class name merging utility (clsx / tailwind-merge)
│   │   ├── curriculum/          # Progression rules, unlock evaluator, and DB seeding
│   │   │   ├── frontierNav.ts   # Level mastery, symbol chips, milestone acks (frontierNav.test.ts)
│   │   │   ├── progressService.ts # Lesson progress tracking and unlock pipeline
│   │   │   ├── rules.ts         # Unlock gate validation rules (Acc >= 95 & WPM > 45)
│   │   │   └── seed.ts          # Database seed script for built-in lessons
│   │   ├── customLessons/       # Custom user lesson domain logic
│   │   │   ├── detabify.ts      # §6.1 pure tab→spaces paste conversion (detabify.test.ts)
│   │   │   └── domain.ts        # Auto-detection of target keys, symbols, and difficulty
│   │   ├── db/                  # SQLite Database Client & Repositories
│   │   │   ├── client.ts        # Tauri SQL plugin client wrapper & migration runner
│   │   │   ├── repositories.ts  # Type-safe CRUD functions for all 8 tables
│   │   │   ├── schema.ts        # Drizzle ORM SQLite schema definition
│   │   │   └── testing.ts       # In-memory mock database for unit tests
│   │   ├── engine/              # Pure Event-Sourced Typing Engine
│   │   │   ├── engine.ts        # Session reducer, character evaluation, event fold
│   │   │   ├── metrics.ts       # Pure metric selectors (WPM, Accuracy, Error Rate)
│   │   │   └── types.ts         # Engine state interfaces, event types, session options
│   │   ├── hotkeys/             # Global hotkey decision engine
│   │   │   └── globalHotkeys.ts # Pure `globalHotkeyDecision` (Alt+1..6, g-chords, /, ?, Ctrl+K)
│   │   │                        #   + palette scoring/ranking (globalHotkeys.test.ts)
│   │   ├── intelligence/        # Adaptive Learning & Weakness Engine
│   │   │   ├── adaptiveGenerator.ts # Generates text injected with user's weak keys
│   │   │   ├── analyzer.ts      # Statistical analyzer over key attempts & rollups
│   │   │   ├── drillService.ts  # Dynamic evolving weakness drill generator
│   │   │   ├── heatmap.ts       # Heatmap color scale calculator
│   │   │   └── microDrill.ts    # 45s Results micro-drill plan builder (microDrill.test.ts)
│   │   ├── io/                  # Import, Export & Backup Subsystem
│   │   │   ├── backupExport.ts  # One-call JSON backup export (+ lastBackupAt stamp)
│   │   │   ├── exporter.ts      # JSON & CSV serialization (lessons, backups, logs)
│   │   │   ├── exportSchema.ts  # Zod schema contracts for import/export JSON files
│   │   │   ├── fileIo.ts        # Tauri native file dialog and disk read/write (`inTauri()` guard)
│   │   │   └── importer.ts      # Validated deserialization & database restoration
│   │   ├── layout/              # Layout-Agnostic Keyboard Definitions
│   │   │   ├── fingers.ts       # Finger assignment mapping
│   │   │   ├── keymap.ts        # Key mapping abstractions and types
│   │   │   └── qwerty.ts        # Physical QWERTY key matrix definition
│   │   ├── session/             # Session workflow logic (golden loop & focus shield)
│   │   │   ├── goldenLoop.ts    # Results key routing: Smart-Enter, Tab+Enter reset, Zen/H toggles
│   │   │   └── focusShield.ts   # `isEditableFocused()` / `releaseChromeFocus()` keyboard guards
│   │   ├── stats/               # Aggregation & Rollup Services
│   │   │   ├── dailyGoalsRepo.ts# Daily goal persistence
│   │   │   ├── dailyRoutine.ts  # Daily-routine derivation, Enter dispatch, streak copy (§5.1/§5.2)
│   │   │   ├── dailyService.ts  # Daily progress, streaks, and consistency computation
│   │   │   ├── format.ts        # Time, date, and metric formatting helpers
│   │   │   ├── progressService.ts # Overall curriculum statistics aggregation
│   │   │   └── weaknessService.ts # Weakness summary service
│   │   ├── format.ts            # Global formatting utilities
│   │   ├── schemas.ts           # Zod domain schemas (Single source of truth)
│   │   ├── screens.ts           # Screen IDs and routing definitions
│   │   └── themeCatalog.ts      # Theme switcher catalog (cycle via palette / settings)
│   ├── screens/                 # 8 Application Screens
│   │   ├── CustomLessonsScreen.tsx   # Custom lesson creator, editor, and catalog
│   │   ├── DashboardScreen.tsx       # Main dashboard: KPIs, continue card, streak, heatmaps
│   │   ├── LessonResultsScreen.tsx   # Post-attempt score, gate evaluation, and key spotlight
│   │   ├── LessonsScreen.tsx         # Full 260-lesson curriculum browser
│   │   ├── SettingsScreen.tsx        # Preferences, layout, backup/restore, data wipe
│   │   ├── StatisticsScreen.tsx      # In-depth analytics, Recharts curves, raw attempt log
│   │   ├── TypingSessionScreen.tsx   # Active typing arena with live telemetry & keyboard
│   │   └── WeaknessTrainingScreen.tsx# Adaptive drills targeting weakest keys/bigrams
│   ├── stores/                  # Zustand Reactive State Stores
│   │   ├── useCurriculumStore.ts     # Curriculum list and per-level progress state
│   │   ├── useCustomLessonsStore.ts  # Custom lessons list and draft management
│   │   ├── useDailyGoalsStore.ts     # Daily training goals and streaks
│   │   ├── useSessionStore.ts        # Active typing session state and engine bridge
│   │   ├── useSettingsStore.ts       # User preferences and app settings
│   │   ├── useStatsStore.ts          # Aggregate statistics and attempt history
│   │   └── useUiStore.ts             # Navigation router and screen parameter state
│   ├── App.tsx                  # Root application router and layout shell
│   ├── main.tsx                 # React entry point
│   └── styles.css               # Tailwind CSS imports and custom token directives
├── src-tauri/                   # Rust Backend & Tauri Configuration
│   ├── capabilities/            # Tauri v2 security capabilities
│   │   └── default.json         # Scoped permissions: fs, dialog, sql, opener,
│   │                            #   core:window (traffic dots), fs:allow-write-text-file (backup export)
│   ├── migrations/              # Versioned SQL migrations generated by drizzle-kit
│   │   ├── 0000_previous_pestilence.sql # Initial 8 PRD tables
│   │   ├── 0001_gorgeous_ben_grimm.sql  # Attempt key spotlight column
│   │   ├── 0002_tidy_liz_osborn.sql     # Daily rollups & bigram statistics
│   │   └── 0003_omniscient_ben_grimm.sql# Custom lesson lifecycle & metadata
│   ├── src/
│   │   ├── lib.rs               # App startup, legacy data migration, plugin registration
│   │   └── main.rs              # Rust binary entrypoint
│   ├── Cargo.toml               # Rust dependencies
│   └── tauri.conf.json          # Tauri configuration (window, bundle, plugins)
├── drizzle-kit.config.ts        # Drizzle migration generator config
├── index.html                   # HTML host template
├── package.json                 # Node dependencies and NPM scripts
├── tsconfig.json                # TypeScript project configuration
├── vite.config.ts               # Vite bundler configuration
└── vitest.config.ts             # Vitest test configuration
```

> **Note:** unit tests live next to their sources as `*.test.ts` (vitest, **node environment** —
> there is no jsdom/Testing-Library harness, so DOM wiring in components is verified by
> type-checking and manual runs, not by tests).

---

## 4. Database Schema & Persistence Architecture

The database is a local SQLite file named `typing_trainer.db` placed in the OS app-config directory (e.g. `~/.config/com.typekernel.app/typing_trainer.db` on Linux).

Migrations are versioned and managed through **Drizzle Kit** (`pnpm db:generate`), generating SQL files in `src-tauri/migrations/`. They are applied automatically and idempotently on startup by `tauri-plugin-sql`.

### Core Tables & Entity Relations

```mermaid
erDiagram
    LESSONS ||--o{ LESSON_PROGRESS : "tracks status for"
    LESSONS ||--o{ LESSON_ATTEMPTS : "has attempts"
    LESSON_ATTEMPTS ||--o{ KEY_STATISTICS : "updates rollup"
    LESSON_ATTEMPTS ||--o{ BIGRAM_STATISTICS : "updates rollup"
    LESSONS ||--o{ TRAINING_SESSIONS : "associates with"
    CUSTOM_LESSONS ||--o{ LESSON_ATTEMPTS : "has custom attempts"

    LESSONS {
        text id PK "e.g. l1-001"
        integer level "1 to 7"
        integer order_index
        text title
        text description
        text content "Code content (\n allowed, no tabs)"
        text target_keys "JSON string array"
        text tags "JSON string array"
        text source "'builtin' | 'custom'"
        integer created_at "epoch ms"
    }

    LESSON_PROGRESS {
        text lesson_id PK, FK
        text status "'locked' | 'available' | 'completed'"
        real best_wpm
        real best_accuracy
        real lowest_error_rate
        integer attempt_count
        integer unlocked_at "epoch ms"
        integer completed_at "epoch ms"
        integer updated_at "epoch ms"
    }

    LESSON_ATTEMPTS {
        integer id PK "autoincrement"
        text lesson_id FK "nullable for drills"
        text kind "'lesson' | 'weakness' | 'adaptive' | 'custom'"
        integer attempt_number
        real wpm
        real accuracy
        real error_rate
        integer error_count
        integer correct_chars
        integer incorrect_chars
        integer backspace_count
        integer duration_ms
        integer completed "boolean (0/1)"
        integer started_at "epoch ms"
        integer finished_at "epoch ms"
        text key_report "JSON object (worst keys & latencies)"
    }

    KEY_STATISTICS {
        text key PK "e.g. 'a', '(', ';'"
        integer shift_required PK "boolean (0/1)"
        integer total_presses
        integer correct_presses
        integer incorrect_presses
        real avg_latency_ms
        integer last_seen_at "epoch ms"
    }

    KEY_STATISTICS_DAILY {
        text date PK "YYYY-MM-DD"
        text key PK
        integer shift_required PK
        integer presses
        integer correct
    }

    BIGRAM_STATISTICS {
        text pair PK "e.g. '->', '{}', 'th'"
        integer total
        integer incorrect
        real avg_latency_ms
    }

    CUSTOM_LESSONS {
        text id PK "custom-uuid"
        text title
        text description
        text content
        text difficulty "'easy' | 'medium' | 'hard'"
        text target_keys "JSON string array"
        text target_symbols "JSON string array"
        real wpm_target "optional target"
        real accuracy_target "optional target"
        integer is_draft "boolean (0/1)"
        text source "'custom' | 'imported'"
        text collection_id "optional collection grouping"
        text syntax_family "e.g. 'typescript', 'rust'"
        text tags "JSON string array"
        integer created_at "epoch ms"
        integer updated_at "epoch ms"
    }

    DAILY_GOALS {
        text date PK "YYYY-MM-DD"
        integer minutes_goal
        integer lessons_goal
        integer chars_goal
    }

    SETTINGS {
        text key PK
        text value "JSON serialized value"
        integer updated_at "epoch ms"
    }
```

### Critical Database Rules
1. **Append-Only Attempts:** The `lesson_attempts` table is an append-only ledger. Attempt rows and their metric columns are **never** `UPDATE`d or deleted during normal application flow.
2. **Nullable `lesson_id` on Attempts:** Drills generated dynamically (weakness & adaptive) have `lesson_id = NULL` and `kind = 'weakness' | 'adaptive'`. Their metrics update key statistics and daily streaks, but **never** modify `lesson_progress`.
3. **First-Boot Legacy Adoption:** In `src-tauri/src/lib.rs`, the app inspects legacy pre-1.0 directories (`com.adev.typing-trainer`) and automatically copies existing `.db` and sidecar files (`-wal`, `-shm`, `-journal`) into `com.typekernel.app` before SQLite initialization.

---

## 5. Core Subsystems

### 5.1 The Typing Engine (`src/lib/engine/`)

The typing engine is a pure, deterministic, event-sourced state reducer:
- **State Interface (`SessionState`):**
  - `content`: Target text string.
  - `position`: Current index in the text.
  - `entries`: Array of `CharEntry` objects tracking `expected`, `typed`, and `status: "pending" | "correct" | "incorrect"`.
  - `correctChars`, `incorrectChars`, `totalKeystrokes`, `backspaceCount`.
  - `startedAt`, `finishedAt` timestamps.
  - `keyEvents`: Keystroke log containing character, correctness, and latency in milliseconds.
- **Reducer Mechanics:**
  - `createSession(content: string)`: Initializes the buffer.
  - `applyEvent(state, event, now, options)`: Folds a single keystroke or backspace into a new immutable `SessionState`.
  - If a typed character is incorrect, the engine records it as `"incorrect"` and **still advances position** (mirroring modern code editors).
  - Backspace steps the position back and resets the cell to `"pending"`.
  - **Backspace Policies (`SessionOptions.backspacePolicy`):**
    - `"counted"` (Default): Backspaces are permitted and recorded in telemetry.
    - `"free"`: Backspaces are permitted but excluded from total backspace penalty count.
    - `"forbidden"`: Backspace key events are discarded; the cursor can only move forward.
- **Metric Formulas (`src/lib/engine/metrics.ts`):**
  $$\text{Gross WPM} = \frac{\text{Total Typed Chars} / 5}{\text{Elapsed Minutes}}$$
  $$\text{Accuracy (\%)} = \frac{\text{Correct Keystrokes}}{\text{Total Typed Chars}} \times 100$$
  $$\text{Error Rate (\%)} = \frac{\text{Incorrect Keystrokes}}{\text{Total Typed Chars}} \times 100$$

### 5.2 Curriculum & Unlock Progression (`src/content/`, `src/lib/curriculum/`)

The curriculum consists of **260 lessons across 7 progressive levels**:

| Level | Name | Lessons | Focus & Key Elements |
|---|---|---|---|
| **L1** | Keyboard Fundamentals | 26 | Home row, top row, bottom row, index finger extensions, basic 3-letter combos. |
| **L2** | Numbers & Sequences | 35 | Number row 0–9, 2-digit pairs, 4-digit blocks, numeric keypad patterns. |
| **L3** | Programming Symbols | 50 | Heavy dedicated practice on: `( ) { } [ ] < > / \ \| & * = + - _ : ; ' " \` ! ? @ # $ %`. Every symbol appears in $\ge 3$ lessons. |
| **L4** | Shift & Capitalization | 48 | Uppercase sequences, mixed shift combos, `camelCase`, `PascalCase`, `snake_case`, `kebab-case`. |
| **L5** | Programming Vocabulary | 42 | Keywords: `function`, `return`, `class`, `interface`, `async`, `await`, `import`, `export`, `const`, `type`, `struct`, etc. |
| **L6** | Programming Syntax | 37 | Realistic syntax constructs: `if (...) {}`, `for (...) {}`, `const [x, setX] = useState()`, `try {} catch (e) {}`, arrow functions, array indices. |
| **L7** | Real Code | 22 | Multi-line real-world code across 8 languages: TypeScript, JavaScript, HTML, CSS, SQL, JSON, Bash, Git commands. |

#### The Unlock Gate Rule (`src/lib/curriculum/rules.ts`)
To unlock lesson $N+1$, the user must complete lesson $N$ with:
$$\text{Accuracy} \ge 95\% \quad \text{AND} \quad \text{WPM} > 45$$
**in the exact same attempt**.
- $50\text{ WPM} + 93\%\text{ Acc} \implies \text{FAIL}$
- $44\text{ WPM} + 98\%\text{ Acc} \implies \text{FAIL}$
- $50\text{ WPM} + 95\%\text{ Acc} \implies \text{PASS (Unlocks next)}$
- $46\text{ WPM} + 97\%\text{ Acc} \implies \text{PASS (Unlocks next)}$

**Irreversibility Guarantee:** Once unlocked, a lesson remains unlocked forever (`unlockIfLocked`). Subsequent low scores never re-lock an unlocked or completed lesson.

### 5.3 Adaptive Intelligence & Heatmaps (`src/lib/intelligence/`)

1. **Key Statistics & Rollups:** Every attempt updates cumulative lifetime `key_statistics` and local daily rollups in `key_statistics_daily`.
2. **Heatmap Scoring (`src/lib/intelligence/heatmap.ts`):** Calculates key heat levels (`strong`, `average`, `weak`, `frequently-incorrect`, `untested`) based on historical error rates and latency.
3. **Bigram Difficulty Tracking:** Analyzes consecutive character pairs in the expected content stream. If either character in a bigram is mistyped, the bigram error count in `bigram_statistics` increments.
4. **Dynamic Weakness Drills (`src/lib/intelligence/drillService.ts`):** Identifies the user's worst keys and bigrams from the rolling 30-day window, generating custom drill buffers that evolve dynamically (e.g. shrinking focus from `{ : ]` $\to$ `: ]` $\to$ `]` as accuracy improves).

### 5.4 Custom Lessons & Import/Export (`src/lib/customLessons/`, `src/lib/io/`)

- **Authoring & Drafts:** Users can create custom lessons with metadata, content, difficulty, syntax family, and custom WPM/accuracy targets. Drafts can be saved without validation errors.
- **Import/Export Pipeline:**
  - Export custom lessons, collections, or complete database backups to JSON.
  - Export raw attempt ledgers to CSV.
  - **Zod Boundary Contract:** All incoming JSON files are validated against strict Zod schemas (`src/lib/io/exportSchema.ts`) **before** touching SQLite. Malformed or corrupted imports are rejected with detailed validation error messages.

### 5.5 Daily Training, Streaks & Goals (`src/lib/stats/`, `src/stores/useDailyGoalsStore.ts`)

- Configurable daily goals: Target Minutes (e.g. 15 min), Target Lessons (e.g. 3 lessons), Target Characters (e.g. 500 chars).
- Automated streak calculation based on daily active training.
- Streak preservation: streaks survive single-goal misses as long as daily training activity is registered.

### 5.6 Keyboard-First UX Layer (`src/lib/hotkeys/`, `src/lib/session/`, `src/lib/curriculum/frontierNav.ts`)

Implements `plans/UX_PERFECTION_WORKFLOW_PLAN.md` (Phases 1–4 shipped 2026-09-26):

- **Global hotkeys (`src/lib/hotkeys/globalHotkeys.ts` + `GlobalHotkeys.tsx`):** a *pure decision function* `globalHotkeyDecision(context, event)` maps key events to actions — `Ctrl/Cmd+K` palette, `Alt+1..6` screen jumps, `g d`/`g l`/`g w`/`g s`/`g c`/`g ,` vim chords (1 s window), `/`, `?`. `GlobalHotkeys.tsx` mounts **once, last, in `App.tsx`**, registers a window **capture-phase** listener, and `stopImmediatePropagation`s chords it consumes so screen-level bubble listeners never double-fire. Bare-letter bindings return `noAction` while a session is running or an editable field is focused.
- **Command palette (`CommandPalette.tsx`):** AND-token scorer + stable ranking (`paletteScore`/`rankPalette`) over lessons (title, `L3-014` module codes, tags, target keys) and app actions (screen jumps, toggles, export, drills). Focus is captured/restored; a successfully-run entry deliberately skips restore so the opener button can't swallow Results/Dashboard Enter.
- **Golden loop (`src/lib/session/goldenLoop.ts`):** `resultsActionFor(key, ctx)` decides Results Enter/Space (`next-lesson` / `retry-lesson`), plus `isTabResetChord` (Tab+Enter, 1.5 s window), `isInstantReset` (Ctrl+R), `isZenToggle` (bare `F` idle / `Ctrl+Shift+F` running), `isHeatmapToggle` (`H` idle / `Ctrl+Shift+H` running).
- **Focus shield (`src/lib/session/focusShield.ts`):** `isEditableFocused()` (inputs/textarea/select/contenteditable) gates every screen-level Enter/Space/letter handler so keystrokes are never hijacked from a focused control; `releaseChromeFocus()` blurs stray chrome focus.
- **Frontier navigation (`src/lib/curriculum/frontierNav.ts`):** pure level-mastery summaries, `SYMBOL_CHIPS` (brackets/parens/arrows/SQL… filter chips), and the level-milestone algorithm (`nextMilestoneToCelebrate` over progress + `localStorage` acks `typekernel.milestone.L<n>`, one celebration per level, freshest first).
- **Micro-drills (`src/lib/intelligence/microDrill.ts`):** `buildMicroDrillPlan(worstKeys, seed, level)` emits a deterministic ≈45 s / 112-char `kind='weakness'` plan for the `D` action on Results; plan ids embed a focus-key digest so return-to-results hints can't collide.
- **Overlays:** `Modal`, `ShortcutsModal`, `CommandPalette` share stacked-overlay rules — capture-phase Escape/Tab with **topmost-dialog ownership** (last `[role=dialog][aria-modal=true]` in document order wins), focus trap and opener restore.

### 5.7 Daily Habit Engine & Developer Ergonomics (`src/lib/stats/dailyRoutine.ts`, `src/lib/customLessons/detabify.ts`)

Implements `plans/UX_PERFECTION_WORKFLOW_PLAN.md` Phases 5–6 (shipped 2026-09-26):

- **Daily Routine (§5.1):** the Dashboard's primary card runs a 3-step habit loop — 60 s weakness warmup (`buildDrillPlan` with `{sets: 1, setLength: 150}` through the normal `kind='weakness'` pipeline, gated on `settings.adaptiveLessons`) → push the frontier (2 `kind='lesson'` attempts) → speed sprint on the fastest mastered module (`pickSprintLesson`). Progress is **derived, never pushed**: `deriveRoutine()` folds finished attempts (`attemptsRepo.finishedSince`) since the per-day `localStorage` clock (`typekernel.routine.<YYYY-MM-DD>` — stale-day keys read as absent, so the routine rolls over at midnight). `dashboardEnterAction()` is the pure Enter dispatcher: unstarted → start, started → continue, **only a complete routine** hands `Enter` back to Resume Frontier (the resume card's `(Enter)` badge follows the same value). Unavailable steps (adaptive drills off, no weakness data, nothing mastered) derive as `skipped` with a human reason and a start click falls through to the first launchable step.
- **Streak motivation (§5.2):** `streakEncouragement(current)` emits tiered static copy (top 20 % at ≥3 days, top 10 % at ≥7, top 1 % at ≥30) with the streak rule as always-visible text — no percentile data is fetched (offline law). The 14-day `ConsistencyStrip` cells carry a styled hover `CellTooltip` (day, status, lessons, minutes) instead of a native `title`.
- **Animated goal rings (§5.3):** `GoalRing.tsx` replaces the old `GoalBar`s — SVG arc commits at 0 and sweeps to the real `pct` one rAF later, clamps the arc at 100 while the centre keeps the true value, and on `met` adds the primary ring + scale-in check. Reduce-motion drops the transition and lands on the final state.
- **Auto-detabifier (§6.1):** pastes with `\t` into the Custom Lessons content textarea are intercepted, converted by pure `detabify(text, tabSize)` (Settings → Appearance `tabSize` = 2 | 4, default 2 = curriculum indent), caret-restored, and badged `Converted N tab(s) to spaces` for 3 s; a silent `onChange` safety net covers drag-drop/IME. The `CustomLessonSchema` "tabs are not supported" refine is deliberately untouched (§8 invariant #4).
- **Transitions & focus polish (§6.2/§6.3):** `App.tsx` wraps the screen switch in `key={activeScreen}` + `animate-screen-in` (150 ms ease-out **opacity-only** — a `transform` would become the containing block for the fixed `LevelMiniMap`/`FrontierHud` and jitter them); `PillGroup` gained a measured sliding indicator shared by the Custom Lessons filters and every Settings pill group; the focus audit fixed the Lessons level-`<select>` and Command Palette input rings, added `Modal` `aria-labelledby`, and the reduced-motion scroll guard in Settings.

---

## 6. User Interface & Screen Architecture

The UI is built as a single-page application inside the Tauri Webview using Zustand for navigation routing (`useUiStore`).

```mermaid
graph TD
    Dashboard[DashboardScreen] --> Lessons[LessonsScreen]
    Dashboard --> Session[TypingSessionScreen]
    Dashboard --> Weakness[WeaknessTrainingScreen]
    Dashboard --> Custom[CustomLessonsScreen]
    Dashboard --> Stats[StatisticsScreen]
    Dashboard --> Settings[SettingsScreen]

    Lessons --> Session
    Custom --> Session
    Weakness --> Session

    Session --> Results[LessonResultsScreen]
    Results --> Session
    Results --> Lessons
    Results --> Dashboard
```

### Screen Inventory

1. **`DashboardScreen` (`src/screens/DashboardScreen.tsx`):** Hero progress card, **Daily Routine** habit card (§5.7), animated daily-goal rings, streak encouragement + 14-day activity strip, KPI summary cards, weak key spotlight, and quick access to weakness drills. `Enter` starts/continues the Daily Routine and only resumes the frontier once it is complete (all paths guarded by `isEditableFocused`, `modalOpen`, `event.repeat`, modifier and focused-button checks).
2. **`LessonsScreen` (`src/screens/LessonsScreen.tsx`):** Full 260-lesson curriculum browser grouped by Level 1–7 with mastery gauges, status filters, symbol-chip bar (`{ Brackets }`, `=> Arrows`, SQL…; OR within chips, AND with query/status/level), text search over title/description/tags/target-keys/**content**, right-side `LevelMiniMap` jump rail, sticky `FrontierHud` (`Enter` = resume frontier), golden "Level Complete" badges, and the `LevelMilestoneModal` celebration on finishing a level. Card/section components are `React.memo`'d; HUD offset is rAF-coalesced.
3. **`TypingSessionScreen` (`src/screens/TypingSessionScreen.tsx`):** Active typing arena with the lesson buffer, live telemetry, `KeyboardVisualization`, **Zen mode** (`Ctrl+Shift+F` running / bare `F` idle; persisted in `settings.zenMode`), whitespace glyphs (`settings.whitespaceGlyphs`), compact heatmap glance (`Ctrl+Shift+H` / idle `H`), instant reset (`Tab+Enter`, `Ctrl+R`) and clean abandon (`Esc`) — all behind the focus shield; IME composition keystrokes are ignored.
4. **`LessonResultsScreen` (`src/screens/LessonResultsScreen.tsx`):** Post-attempt summary with Smart Enter (advance on pass, instant retry on fail), Space replay-for-PR, Esc curriculum, and the **`D` Targeted Micro-Drill** card (worst ≥2-miss keys → `buildMicroDrillPlan` → Weakness screen, returns here via a plan-bound hint). Custom lessons judge against personal targets (`evaluatePersonal`), never the §8 gate.
5. **`StatisticsScreen` (`src/screens/StatisticsScreen.tsx`):** Lifetime analytics. Includes Recharts WPM/accuracy progression curves, 90-day consistency heatmap, full interactive `KeyHeatmap`, and the paginated raw attempt ledger with CSV export. (Lazy-loaded — must stay out of the entry chunk.)
6. **`WeaknessTrainingScreen` (`src/screens/WeaknessTrainingScreen.tsx`):** Adaptive drill mode with rapid-fire set transitions — `Space`/`Enter` advance (skippable 1.5 s countdown that re-checks live phase and never fires behind an open dialog), `Ctrl+R` restarts the current set (never reloads the webview), unmount `abandon()`s the session, and analysis errors surface with a Retry affordance.
7. **`CustomLessonsScreen` (`src/screens/CustomLessonsScreen.tsx`):** Management dashboard for user-authored and imported lessons. Supports CRUD, drafting, filtering by syntax family, and JSON import/export.
8. **`SettingsScreen` (`src/screens/SettingsScreen.tsx`):** Application preferences (theme, keymap, backspace policy, daily goals, **Zen mode**, **whitespace glyphs**), full database backup/restore (`exportBackupJson` reports "desktop app only" outside Tauri), and destructive reset flow.

Global chrome: `TopBar.tsx` traffic dots drive real Tauri window controls (behind a `__TAURI_INTERNALS__` guard; close first `abandon()`s an in-flight session), and `GlobalHotkeys.tsx` owns every global chord plus the palette/cheatsheet overlays.

---

## 7. Data Flow & Lifecycle Walkthrough

### 7.1 Lifecycle of a Typing Attempt

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as TypingSessionScreen
    participant Store as useSessionStore
    participant Engine as src/lib/engine
    participant DB as SQLite (repositories.ts)
    participant Progress as progressService
    participant Results as LessonResultsScreen

    User->>UI: Selects Lesson & Presses Key
    UI->>Store: startSession(lessonId, content)
    Store->>Engine: createSession(content)
    
    loop Every Keystroke
        User->>UI: KeyDown (char or backspace)
        UI->>Store: handleInput(char)
        Store->>Engine: applyEvent(state, event, now)
        Engine-->>Store: Updated SessionState
        Store-->>UI: LiveMetrics (WPM, Acc, Errors)
    end

    User->>UI: Types Final Character
    Store->>Engine: applyEvent() -> state.finishedAt != null
    Store->>Progress: finishAttempt(sessionData)
    
    rect rgb(30, 40, 50)
        Note over Progress,DB: Atomic Persistence Pipeline
        Progress->>DB: INSERT into lesson_attempts (immutable)
        Progress->>DB: UPSERT key_statistics & key_statistics_daily
        Progress->>DB: UPSERT bigram_statistics
        alt Is Curriculum Lesson
            Progress->>Progress: Evaluate rules.shouldUnlockNext(acc, wpm)
            Progress->>DB: UPDATE lesson_progress (bests & status)
            alt Passed Gate
                Progress->>DB: UPDATE next lesson_progress -> 'available'
            end
        end
    end

    Progress-->>Store: Saved Attempt & Unlock Status
    Store->>UI: Navigate to "lesson-results"
    UI->>Results: Render Score, Keys Spotlight & Next Actions
```

---

## 8. Invariants & Rules for LLM Coding Sessions

When implementing features, fixing bugs, or refactoring code in this repository, you **MUST** adhere to the following architectural invariants:

### 1. The 100% Offline Rule
- **Never** add network fetch calls, CDN links, analytics trackers, or external API endpoints.
- **Never** load fonts or stylesheets from external URLs at runtime. All fonts and assets must be vendored under `public/` or compiled into Tailwind.

### 2. Immutability of Historical Attempts
- The `lesson_attempts` table is an append-only ledger.
- **Never** execute an `UPDATE` query on metric columns (`wpm`, `accuracy`, `error_rate`, etc.) of `lesson_attempts`.
- Charts and statistics must always read from the complete attempt history and never reduce records to a single "best score".

### 3. Unlock Gate Enforcement
- Unlocking the next lesson requires **Accuracy $\ge 95\%$ AND WPM $> 45$** on the **same attempt**.
- **Never** re-lock an already unlocked or completed lesson, regardless of future poor attempt scores.

### 4. Boundary Validation with Zod
- **Never** pass unvalidated user input or parsed JSON directly to database queries.
- All domain objects, imported JSON files, and custom lesson inputs must be validated through `src/lib/schemas.ts` or `src/lib/io/exportSchema.ts` first.

### 5. Layout Agnosticism
- Avoid hardcoding physical keyboard positions or key coordinate assumptions directly inside components.
- Always consume layout definitions from `src/lib/layout/` so future keyboard layouts (e.g. Dvorak, Colemak) can be plugged in without UI rewrites.

### 6. Clean Separation of State
- **Transient UI State:** Use Zustand stores (`useSessionStore`, `useUiStore`) for in-memory session timers, keystroke buffers, and screen navigation.
- **Persistent Domain State:** Use SQLite repositories (`src/lib/db/repositories.ts`) for attempt history, lesson progress, daily goals, and settings.

### 7. Keyboard-Handler Discipline
- Every `window.addEventListener("keydown", …)` **must** be removed in its effect cleanup; prefer pure decision helpers (`globalHotkeyDecision`, `resultsActionFor`, `isZenToggle`…) in `src/lib/hotkeys/` and `src/lib/session/` over hand-rolled key comparisons in components.
- Before acting on an unmodified key (letters, `Enter`, `Space`), bail when `isEditableFocused()` (or a focused button/anchor would be hijacked) and on `event.repeat` / IME composition (`event.isComposing` / `keyCode 229`).
- Never bind a bare letter that can occur in lesson content *while a session is running* — use a modified chord there (`Ctrl+Shift+F` not `F`, `Ctrl+Shift+H` not `H`); the chord must also be registered in `ShortcutsModal`/the keybinding matrix so docs don't drift.
- New global chords go through `GlobalHotkeys` (capture phase + `stopImmediatePropagation`) so they can't double-fire with screen-level bubble listeners; new overlays must join the topmost-dialog Escape/Tab ownership check.

---

## 9. Development & Build Commands

### Environment Setup
- **Prerequisites:** Node.js $\ge 20$, `pnpm`, Rust (stable), `gtk3`, `webkit2gtk-4.1`.

```sh
# Install all JavaScript dependencies
pnpm install
```

### Development
```sh
# Run web frontend with Vite HMR (browser mode)
pnpm dev

# Run full native desktop app with Tauri v2
pnpm tauri dev
```

### Testing & Auditing
```sh
# Run all Vitest TypeScript unit & integration test suites
pnpm test

# Type-check without emitting (run this before considering any change done)
npx tsc --noEmit

# Run Rust backend test suite
cd src-tauri && cargo test && cd ..

# Check bundle sizes and performance budgets
pnpm perf:budget
```

### Database & Migrations
```sh
# Generate new SQL migrations from schema modifications in src/lib/db/schema.ts
pnpm db:generate
```

### Production Build & Packaging
```sh
# Build frontend and compile Linux native AppImage
pnpm tauri build
# Output: src-tauri/target/release/bundle/appimage/TypeKernel_1.0.0_amd64.AppImage
```

---

## 10. Summary Cheat Sheet for LLMs

- **Project:** TypeKernel (Coding Touch Typing Trainer).
- **Core Stack:** Tauri v2 (Rust) + React 19 + TypeScript + Tailwind 4 + Zustand + SQLite + Drizzle ORM.
- **Curriculum:** 260 lessons, 7 levels (`src/content/`).
- **Pass Threshold:** $\ge 95\%$ accuracy AND $> 45$ WPM on the same attempt.
- **Persistence:** Local SQLite (`typing_trainer.db`) via `tauri-plugin-sql`, migrations in `src-tauri/migrations/`.
- **Navigation:** Handled via `useUiStore` (`dashboard`, `lessons`, `typing-session`, `lesson-results`, `statistics`, `weakness-training`, `custom-lessons`, `settings`).
- **Keyboard-first layer (UX plan Phases 1–4 ✅):** `GlobalHotkeys.tsx` + `lib/hotkeys/globalHotkeys.ts` (Ctrl+K, Alt+1..6, g-chords, `/`, `?`) and `lib/session/goldenLoop.ts` + `focusShield.ts` (Smart Enter, Tab+Enter, Zen `F`/`Ctrl+Shift+F`, heatmap `H`/`Ctrl+Shift+H`, `D` micro-drill). Full matrix: `plans/UX_PERFECTION_WORKFLOW_PLAN.md` §10.
- **Pre-commit gate:** `npx tsc --noEmit && pnpm test` (31 files / 336 tests as of 2026-09-26); perf budget `pnpm build && pnpm perf:budget` (entry ≈199.6 KB gzip, budget 400 KB).
- **Status:** UX plan **Phases 1–6 all implemented & verified (2026-09-26)** — Phase 5 = Daily Routine card + Enter dispatch + animated goal rings + streak copy/strip tooltip (`lib/stats/dailyRoutine.ts`, `GoalRing.tsx`); Phase 6 = paste auto-detabifier (`lib/customLessons/detabify.ts`), `tabSize` setting, 150 ms screen fade, sliding `PillGroup` indicator, focus/a11y audit fixes.
- **Key Philosophy:** 100% offline, privacy-first, zero telemetry, developer-centric symbol focus.
