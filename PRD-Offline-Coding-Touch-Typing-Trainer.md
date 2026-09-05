# Product Requirements Document
## Offline Coding Touch Typing Trainer

**Document Type:** PRD
**Platform:** Linux Desktop (Arch Linux primary target)
**Status:** Draft v1.0

---

## 1. Overview

A Linux-first, fully offline desktop application for learning and improving touch typing, with a strong focus on **programming and code typing**. Inspired by progressive lesson systems like EdClub, but purpose-built for developers who want to improve typing speed, accuracy, symbol fluency, and muscle memory while coding.

The application requires no backend, account, cloud service, or internet connection during normal use.

**Product philosophy:** The app does not simply answer "how fast can you type?" — it answers "how effectively can you type real programming code, and what should you practice next to improve?" It combines a progressive curriculum, real-time measurement, historical statistics, adaptive training, weakness detection, and coding-specific content.

---

## 2. Core Goals

1. Teach touch typing progressively, covering the entire keyboard.
2. Provide at least **250 ready-made lessons**.
3. Focus heavily on programming and code.
4. Measure typing performance in real time.
5. Keep a complete history of every lesson attempt.
6. Track progress from the first lesson to the final lesson.
7. Require a defined performance level before unlocking the next lesson.
8. Identify the user's weak keys and symbols, and adapt future training accordingly.
9. Allow unlimited repetition of completed lessons.
10. Support custom, user-authored lessons.
11. Work completely offline.
12. Remain lightweight and fast on Linux.

---

## 3. Target Platform

**Primary:** Linux, with Arch Linux as the primary target. Wayland is supported; X11 is supported where practical.

**Distribution formats (candidates):**
- Arch Linux `.pkg.tar.zst`
- AppImage
- AUR package (later)

The app should feel like a native Linux desktop application, not a web app wrapped in a heavy runtime.

---

## 4. Technology Stack

| Area | Technology |
|---|---|
| Desktop Framework | Tauri 2 |
| Frontend | React |
| Language | TypeScript |
| Build Tool | Vite |
| Styling | Tailwind CSS |
| State Management | Zustand |
| Database | SQLite |
| Database Layer | Drizzle ORM |
| Built-in Lessons | Local JSON / TypeScript |
| Charts | Recharts |
| Icons | Lucide React |
| Validation | Zod |
| Package Manager | pnpm |

### 4.1 Architecture

```
React + TypeScript
        |
        v
     Tauri 2
        |
        v
     SQLite
```

There is no separate backend. The app explicitly avoids: Electron, Redux, Redis, a REST backend, a cloud database, background workers, message queues, and cloud synchronization.

---

## 5. Offline Requirement

Offline functionality is fundamental — the app must be fully usable with no internet access.

**All important data lives locally:**
- Built-in lessons and lesson metadata
- User progress and lesson attempts
- Statistics and key performance data
- Adaptive-training data
- Custom lessons, settings, daily goals, training history

**Internet may only be used for:** application updates, downloading a newer release, external distribution. Training itself never depends on the internet.

---

## 6. Lesson System

At least 250 lessons, forming a progressive curriculum (not 250 unrelated typing tests), moving from keyboard fundamentals toward realistic programming.

### Level 1 — Keyboard Fundamentals
Home row, top row, bottom row, individual keys, finger positioning, key combinations, basic words and sequences.

### Level 2 — Numbers
`0–9`, including combinations and sequences.

### Level 3 — Programming Symbols
Strong emphasis on: `( )` `{ }` `[ ]` `< >` `/` `\` `|` `&` `*` `=` `+` `-` `_` `:` `;` `'` `"` `` ` `` `!` `?` `@` `#` `$` `%`. These receive significant dedicated training due to their programming importance.

### Level 4 — Shift and Capitalization
Uppercase letters, shift combinations, capitalized identifiers, mixed-case words, camelCase, PascalCase, snake_case, kebab-case.

### Level 5 — Words and Programming Patterns
Common vocabulary: `function`, `variable`, `return`, `class`, `interface`, `object`, `array`, `async`, `await`, `import`, `export`, `const`, `let`, `type`, `string`, `number`, `boolean`.

### Level 6 — Programming Syntax
Structures such as: `if (...) {}`, `for (...) {}`, `function example() {}`, `const value = ...`, `object.property`, `array[index]`, `items.map(...)`, `try {} catch {}`, `async function ...`.

### Level 7 — Real Code
Code-oriented lessons using JavaScript, TypeScript, HTML, CSS, SQL, JSON, Bash, and Git commands, progressively resembling real-world code.

### 6.1 Symbol / Element Focus (cross-cutting)
Brackets, parentheses, curly braces, square brackets, angle brackets, quotes, backticks, semicolons, colons, operators, underscores, pipes, ampersands, backslashes, numbers, shift combinations, common identifiers, code patterns, syntax-heavy sequences. Goal: the user becomes comfortable typing code without constantly looking at the keyboard.

---

## 7. Lesson Access System

The complete lesson list is always visible, with per-lesson state:

- ✓ Completed
- ● Current / Available
- 🔒 Locked

**Completed lessons** remain unlocked permanently, are accessible at any time, can be repeated unlimited times, and can be used to improve previous results.

**Current lesson** is available to attempt.

**Future lessons** are visible (so the user sees the full curriculum and their position in it) but cannot be started.

---

## 8. Lesson Unlock Requirements

The next lesson unlocks only when the current lesson meets **both** conditions in the same attempt:

- Accuracy ≥ 95%
- **AND** WPM > 45

| WPM | Accuracy | Result |
|---|---|---|
| 50 | 93% | FAIL |
| 44 | 98% | FAIL |
| 50 | 95% | PASS |
| 46 | 97% | PASS |

Once unlocked, a lesson stays unlocked — repeating older lessons must never re-lock previously unlocked lessons.

---

## 9. Real-Time Monitoring

During every typing session, the interface displays live-updating stats:

- Current WPM
- Current accuracy
- Error rate
- Correct / incorrect / total characters
- Backspace usage
- Elapsed time
- Lesson progress / completion percentage

The user must not have to wait until the lesson ends to see performance.

---

## 10. Lesson Attempts

Every lesson start creates a new attempt/session; previous attempts are never overwritten. Each completed attempt stores:

- WPM, accuracy, error rate, error count
- Correct / incorrect characters
- Backspace/correction count
- Duration, date, time
- Completion status

Example — Lesson #42: Attempt 1 (WPM 38 / Acc 91% / Errors 14) → Attempt 2 (WPM 43 / Acc 94% / Errors 9) → Attempt 3 (WPM 47 / Acc 97% / Errors 5), so improvement over time is visible.

---

## 11. Lesson Statistics

Per-lesson history includes: best WPM, best accuracy, lowest error rate, number of attempts, latest and previous attempts, performance progression, completion status, and unlock status.

---

## 12. Overall Progress Tracking

Tracks: total lessons, completed lessons, overall completion %, current lesson, last completed lesson, highest unlocked lesson, total attempts, overall WPM/accuracy, and training history.

Example:
```
Overall Progress: 42%
Level 1   20 / 20
Level 2   35 / 35
Level 3   27 / 50
Level 4    0 / 50
Level 5    0 / 50
Level 6    0 / 45

Current Lesson: 78 — TypeScript Objects
Best WPM: 52   Accuracy: 97%   Attempts: 6
```
The user can always continue from their current position.

---

## 13. Adaptive Lessons

One of three core intelligent-training features. The app analyzes historical data to detect: frequently incorrect keys/symbols, difficult key combinations, repeated error patterns, low-accuracy characters, and problematic programming symbols. The lesson engine increases the appearance of weak characters/patterns in future exercises.

```
User Performance → Identify Weaknesses → Adapt Training → More Practice on Weak Areas → Improved Performance
```

---

## 14. Key Heatmap

A visual keyboard heatmap built from accumulated performance data, showing strong / average / weak / frequently-incorrect keys and symbols, covering both standard keys and programming symbols. Based on real historical performance, not arbitrary or predefined difficulty.

---

## 15. Weakness Training

A dedicated mode that auto-generates practice sessions from the user's weakest keys/symbols (e.g., `{`, `:`, `]`, `_`) and evolves as those weaknesses shrink (e.g., `{ : ]` → `: ]` → `]`).

---

## 16. Custom Lessons

Users can create their own lessons with: title, description, content, difficulty, target keys, target symbols, optional WPM target, optional accuracy target. Stored locally; fully offline.

---

## 17. Import / Export

Local import/export of custom lessons, lesson collections, progress backups, and (where appropriate) statistics backups. JSON is the preferred exchange format (portable, human-readable, validatable, versionable, manually editable). **Zod validates all imported data before acceptance.**

---

## 18. Daily Training

Lightweight consistency system with optional goals (e.g., 15 minutes / 3 lessons / 500 characters), tracking daily training time, lessons completed, characters typed, streaks, and consistency. Complements — does not replace — the main curriculum.

---

## 19. Keyboard Layout Support

Initial target: QWERTY. The lesson engine's architecture should avoid hard-coding to a single physical keyboard mapping, to allow future layout support.

---

## 20. Main Application Screens

- **Dashboard** — overall progress, current lesson, highest unlocked lesson, recent attempts, WPM, accuracy, streak, weak keys, quick access to weakness training.
- **Lessons** — full curriculum list with ✓ / ● / 🔒 states.
- **Typing Session** — lesson content, real-time WPM/accuracy/errors/timer/progress, keyboard visualization, current character/position.
- **Lesson Results** — WPM, accuracy, error rate, errors, correct/incorrect characters, backspaces, duration, pass/fail, unlock result, comparison to previous attempts.
- **Statistics** — overall WPM/accuracy, WPM/accuracy history, lesson & attempt history, key heatmap, weak keys, long-term progress.
- **Weakness Training** — auto-generated training from accumulated performance.
- **Custom Lessons** — create / edit / delete / import / export / practice.
- **Settings** — keyboard layout, appearance, training preferences, statistics preferences, data management, import/export, application behavior.

---

## 21. Local Database

SQLite stores mutable user data. Conceptual schema:

- `lessons`
- `lesson_progress`
- `lesson_attempts`
- `key_statistics`
- `training_sessions`
- `custom_lessons`
- `daily_goals`
- `settings`

Built-in lesson content stays bundled as local JSON/TypeScript resources; user-generated and frequently changing data lives in SQLite.

### 21.1 Data Relationships

```
Lesson
  +---- Lesson Progress
  +---- Attempt 1
  +---- Attempt 2
  +---- Attempt N

Typing Attempts
       v
Key Statistics
       +----> Key Heatmap
       +----> Adaptive Lessons
       +----> Weakness Training
```

---

## 22. Frontend State

Zustand manages transient session/UI state: current lesson, current session, timer, current WPM/accuracy/errors/progress, UI state, preferences. Persistent historical data stays in SQLite, not frontend-only state.

---

## 23. Validation

Zod validates: custom lesson data, imported lessons, imported backups, lesson configuration, user-defined targets, and data exchanged between application layers. Invalid imported data must never corrupt the local database.

---

## 24. Statistics and Charts

Recharts powers visual analytics: WPM over time, accuracy over time, performance per lesson, improvement across attempts, overall curriculum progress, long-term performance. Raw attempt history always remains available — history is never reduced to a single "best score."

---

## 25. Performance (Non-Functional) Requirements

- Fast startup, low memory and CPU usage
- No unnecessary background processes, no network requirement
- Fast lesson loading, instant keyboard response
- Smooth real-time statistics, efficient local database operations
- Tauri 2 chosen over Electron specifically to keep the app lightweight

---

## 26. Core User Flow

```
Open Application → Dashboard → Choose Available Lesson → Start Typing Session
   → Real-Time Monitoring → Finish Lesson → Calculate Results → Save Attempt
   → Update Lesson Statistics → Update Key Statistics → Analyze Weaknesses
        +----> Key Heatmap
        +----> Adaptive Lessons
        +----> Weakness Training
   → Check Unlock Requirements (Accuracy >= 95% AND WPM > 45?)
        YES → Unlock Next Lesson
        NO  → Repeat Lesson
```

---

## 27. Final Product Definition

An offline Linux desktop coding touch-typing trainer, primarily targeted at Arch Linux users, defined by:

- Linux-first, Arch Linux focused, fully offline during normal operation
- Stack: Tauri 2, React, TypeScript, Vite, Tailwind CSS, Zustand, SQLite, Drizzle ORM, Zod, Recharts, Lucide React, pnpm
- 250+ built-in progressive lessons with complete keyboard coverage
- Programming-symbol training; JS/TS-focused code training plus HTML/CSS/SQL/JSON/Bash/Git
- Custom lesson creation and import/export
- Real-time performance monitoring; per-attempt and per-lesson statistics
- Complete curriculum progress tracking (completed lessons stay accessible, future lessons stay locked)
- Unlock rule: Accuracy ≥ 95% AND WPM > 45
- Adaptive Lessons, Key Heatmap, Weakness Training
- Daily training / consistency tracking
- Local persistence only — no backend, no cloud dependency, no account requirement
- Lightweight desktop experience

**Goal:** build real programming typing muscle memory, not merely maximize a generic typing-test WPM score.
