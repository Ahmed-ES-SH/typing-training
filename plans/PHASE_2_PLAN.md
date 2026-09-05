# PHASE 2 PLAN — Architecture & App Shell

**Parent:** [MAIN_PLAN.md](./MAIN_PLAN.md) → Phase 2
**PRD sections covered:** §4 (Technology Stack / Architecture), §20 (screens shell only), §22 (Frontend State), §25 (Performance non-functionals)
**Design references:** all 8 folders under `screens/*_typekernel/` (`code.html` + `screen.png`) — especially the shared top status bar and page background/surface treatment
**Status:** Planned — not started. This document is the implementation contract for Phase 2; **do not start Phase 3+ work in this phase.**

---

## 1. Goal

Turn the current Tauri + React boilerplate into a clean, TypeKernel-styled application shell: boilerplate removed, project structure established, design tokens compiled into Tailwind 4, fonts/icons self-hosted for full offline operation, zustand-based navigation between the 8 screens, and every screen present as a stub ready to be filled by later phases. At the end of this phase the app launches on Linux and looks like the designs (empty states), with zero demo code left.

**Explicitly out of scope (later phases):** SQLite/Drizzle schema and migrations (Phase 3), typing engine (Phase 3), real screen content (Phases 3–7), daily goals/streaks logic (Phase 8 — the TopBar/placeholder shows static demo values where needed).

---

## 2. Current State (analyzed)

| Area | File(s) | State | Action |
|---|---|---|---|
| React entry | `src/main.tsx` | Renders `App`, imports `./styles.css` | Keep, minor cleanup |
| Demo app | `src/App.tsx` | Tauri greet demo, imports `App.css`, `react.svg`, `invoke("greet")` | **Delete** (replace with shell `App`) |
| Demo styles | `src/App.css` | Vite/Tauri demo CSS (`.logo`, `.row`, light theme `:root`) | **Delete** |
| Global styles | `src/styles.css` | `@import "tailwindcss"` + minimal `@theme` (blue primary, wrong mono font) | **Rewrite** with TypeKernel tokens |
| Demo asset | `src/assets/react.svg` | Unused after cleanup | **Delete** |
| Demo assets | `public/vite.svg`, `public/tauri.svg` | favicon / demo | **Delete** (replace favicon) |
| HTML entry | `index.html` | Title "Tauri + React + Typescript", vite favicon | Update title/favicon/meta, `class="dark"` |
| Rust entry | `src-tauri/src/lib.rs` | `greet` command + `invoke_handler` | **Remove greet**, keep builder; plugins: `opener` registered, `sql` **not registered yet** (dependency already in `Cargo.toml`) |
| Rust entry | `src-tauri/src/main.rs` | Standard, fine | Keep |
| Tauri config | `src-tauri/tauri.conf.json` | 800×600, title "typing-trainer", CSP null | Update window size/title; set a CSP in hardening pass |
| Capabilities | `src-tauri/capabilities/default.json` | `core:default`, `opener:default` | Keep (add `sql` permission in Phase 3 when DB lands) |
| Build tooling | `vite.config.ts`, `tsconfig*.json` | Correct Tauri template (port 1420, tailwindcss plugin) | Keep as-is |
| Dependencies | `package.json` | Full PRD stack already installed (react 19, zustand, zod, recharts, lucide, drizzle, tauri-plugin-sql, tailwindcss 4 via `@tailwindcss/vite`) | No installs needed |

**Key constraint discovered:** the design mockups use a JS-style `tailwind.config` object (Tailwind 3 CDN). The app uses **Tailwind 4**, which is CSS-first — all tokens must be translated into `@theme` variables in `src/styles.css` (mapping table in §3.3). Class names in the designs (e.g. `bg-surface-container-low`, `font-code-md`, `text-code-sm`, `px-space-base`) must compile to identical CSS in the app.

---

## 3. Tasks

### 3.1 Remove boilerplate (frontend + Rust)
- Delete `src/App.css`, `src/assets/react.svg`, `public/vite.svg`, `public/tauri.svg`.
- Remove the `greet` command from `src-tauri/src/lib.rs` (command fn + `generate_handler![...]` entry); builder keeps `tauri_plugin_opener` for now.
- Replace `src/App.tsx` with the shell root (§3.5).

### 3.2 Project structure
Create the canonical tree (empty folders get an `.gitkeep` or minimal placeholder module):

```
src/
  main.tsx              # entry — keep
  App.tsx               # shell root: TopBar + active screen
  styles.css            # Tailwind 4 @theme tokens + @font-face (§3.3, §3.4)
  lib/
    screens.ts          # ScreenId union, screen registry (id, label, icon)
  stores/
    useUiStore.ts       # zustand: active screen + navigate()
  screens/              # 8 stub screens, one file each (§3.6)
  components/
    TopBar.tsx          # shared status bar (§3.5)
    Shell.tsx           # layout wrapper (bg-surface, min-h-screen flex-col)
  content/              # (empty — lesson generators land in Phase 4)
src-tauri/              # Rust side per §3.1
public/
  fonts/                # self-hosted woff2 files (§3.4)
  icons/                # app favicon (temporary TypeKernel glyph)
```

### 3.3 TypeKernel design tokens → Tailwind 4 `@theme`
Rewrite `src/styles.css` translating the shared `tailwind.config` block found in every `screens/*/code.html`:

- **Colors** (`--color-*`): `background #0f131c`, `surface #0f131c`, `surface-dim #0f131c`, `surface-bright #353943`, `surface-container-lowest #0a0e17`, `surface-container-low #181b25`, `surface-container #1c1f29`, `surface-container-high #262a34`, `surface-container-highest #31353f`, `surface-variant #31353f`, `surface-tint #ffb690`, `on-surface`/`on-background`/`inverse-surface #dfe2ef`, `on-surface-variant #e0c0b1`, `primary #ffb690`, `primary-container #f97316`, `on-primary #552100`, `on-primary-container #582200`, `primary-fixed #ffdbca`, `primary-fixed-dim #ffb690`, `secondary #ffb783`, `secondary-container #d97722`, `on-secondary #4f2500`, `on-secondary-container #451f00`, `secondary-fixed #ffdcc5`, `secondary-fixed-dim #ffb783`, `tertiary #ffb599`, `tertiary-container #ff6d2c`, `on-tertiary #5a1c00`, `on-tertiary-container #5d1d00`, `tertiary-fixed #ffdbce`, `tertiary-fixed-dim #ffb599`, `error #ffb4ab`, `error-container #93000a`, `on-error #690005`, `on-error-container #ffdad6`, `outline #a78b7d`, `outline-variant #584237`, `inverse-primary #9d4300`, `inverse-on-surface #2c303a`, plus all `*-fixed`/`on-*-fixed*` variants from the config.
- **Radii** (`--radius-*`): default `0.125rem`, `lg 0.25rem`, `xl 0.5rem`, `full 0.75rem`.
- **Spacing** (`--spacing-*`): `space-2xs 0.125rem`, `space-xs 0.25rem`, `space-sm 0.5rem`, `space-md 0.75rem`, `space-base 1rem`, `space-lg 1.5rem`, `space-xl 2rem`, `space-2xl 3rem`, `gutter-mobile 0.75rem`, `gutter-desktop 1.25rem`, `sidebar-width 16rem`, `terminal-drawer-collapsed 2.5rem`.
- **Fonts** (`--font-*`): `body-*`/`headline-*`/`display-*`/`label-md` → `"Inter"`, `code-*`/`label-sm` → `"JetBrains Mono"`.
- **Type scale** (`--text-*` with paired line-height/letter-spacing/weight): `display-lg 40/48`, `headline-xl 32/40`, `headline-lg 24/32`, `headline-md 18/26`, `body-lg 16/24`, `body-md 14/22`, `body-sm 12/18`, `code-lg 14/22 (500)`, `code-md 13/20`, `code-sm 11/16 (500)`, `label-md 13/18 (500)`, `label-sm 11/14 (600, 0.06em)` — exactly as in the design config.
- Base layer: dark background, `overscroll-behavior: none`, styled 5px scrollbar (per `current_lesson` design), `select-none` default on shell.
- **Acceptance test:** a scratch element using `bg-surface-container-low p-space-lg font-code-sm text-code-sm rounded-xl` compiles to the same CSS values as the same classes in `screens/dashboard_typekernel/code.html`.

### 3.4 Self-host fonts + icons (offline hardening)
- Download once (dev-time internet is allowed; runtime never needs it): **Inter** (400–700), **JetBrains Mono** (400–700), **Material Symbols Outlined** variable font — woff2 into `public/fonts/`.
- Add `@font-face` rules + the `.material-symbols-outlined` class (with `font-variation-settings` support) in `styles.css`; remove all Google Fonts `<link>` tags from the app (designs keep theirs — they are reference mockups only).
- Favicon: simple TypeKernel glyph (orange bracket/terminal motif) as `public/icons/favicon.svg`.
- Decide icon strategy per component: Material Symbols font for parity with designs; `lucide-react` acceptable where it matches visually. Document the choice in `src/components/README.md`.
- **Offline audit (early):** with network disabled, launch app — fonts and icons must render identically.

### 3.5 App shell (TopBar + navigation + root)
- **`src/lib/screens.ts`** — `ScreenId` union: `dashboard | lessons | typing-session | lesson-results | statistics | weakness-training | custom-lessons | settings`; registry array with label + icon name (icon names chosen to match design language, e.g. `space_dashboard`, `checklist`, `keyboard`, `fact_check`, `monitoring`, `monitor_heart`, `construction`, `settings`).
- **`src/stores/useUiStore.ts`** — zustand store: `activeScreen: ScreenId` (default `dashboard`), `navigate(screenId)`. No router dependency (MAIN_PLAN decision). Lesson/session/results navigation parameters will be added by later phases — keep the store minimal now (YAGNI).
- **`src/components/TopBar.tsx`** — shared 40px status bar matching all 8 designs: left = traffic-dot cluster (decorative; native Tauri window decorations stay enabled — do not fake window controls beyond the design's static dots), `TAURI v2-OFFLINE` badge with pulsing dot, contextual status chip (static per screen for now); right = contextual info (streak/WPM placeholder values), avatar circle. Exact markup reference: header block in `screens/dashboard_typekernel/code.html`.
- **`src/App.tsx`** — `Shell` (flex column, `min-h-screen bg-surface text-on-surface font-body-md`) + `TopBar` + active screen from the store. `class="dark"` on `<html>` in `index.html`; update `<title>` to "TypeKernel".
- **Placeholder screens (§3.6)** — each of the 8 screens is a stub component that renders its breadcrumb line (`~ / <screen> // <label>`) and a centered "Phase N will implement this screen" note, already wrapped in the surface/card classes so the shell reads correctly.
- Keyboard navigation (optional polish, cheap now): Ctrl+1..8 / arrow shortcuts via the store — defer if it risks scope creep.

### 3.6 Screen stubs
Create exactly eight files in `src/screens/`: `DashboardScreen.tsx`, `LessonsScreen.tsx`, `TypingSessionScreen.tsx`, `LessonResultsScreen.tsx`, `StatisticsScreen.tsx`, `WeaknessTrainingScreen.tsx`, `CustomLessonsScreen.tsx`, `SettingsScreen.tsx` — all stubs, each annotated with a pointer to its design folder (`screens/<name>_typekernel/`) for the phase that implements it.

### 3.7 Tauri window & config
- `tauri.conf.json`: window `title: "TypeKernel"`, `width: 1600`, `height: 1000`, `minWidth: 1200`, `minHeight: 768`, `resizable: true`, `center: true` (designs were rendered at 1600×1000). Keep `productName`/identifier unchanged (packaging decision lands in Phase 9).
- Deferred deliberately: `tauri-plugin-sql` registration + capability permission (Phase 3 does this together with schema/migrations); CSP hardening (Phase 9); tray/updates (out of PRD scope).

### 3.8 Performance guardrails (§25, established now, not retrofitted)
- No chart/screen code-splitting yet (nothing to split), but: keep the entry lean — no top-level imports of recharts/drizzle in Phase 2 files; zustand store is the only global state; zero network calls anywhere in the frontend; no timers/intervals in the shell.

---

## 4. File Change Summary

| File | Change |
|---|---|
| `src/App.tsx` | Rewrite → shell root |
| `src/App.css`, `src/assets/react.svg`, `public/vite.svg`, `public/tauri.svg` | Delete |
| `src/styles.css` | Rewrite → TypeKernel `@theme` tokens + `@font-face` + base layer |
| `index.html` | Title "TypeKernel", `class="dark"`, local favicon, no CDN links |
| `src/lib/screens.ts` | New — screen registry |
| `src/stores/useUiStore.ts` | New — zustand navigation store |
| `src/components/TopBar.tsx`, `src/components/Shell.tsx` | New — shell chrome |
| `src/screens/*.tsx` (8 files) | New — annotated stubs |
| `public/fonts/*`, `public/icons/favicon.svg` | New — self-hosted assets |
| `src-tauri/src/lib.rs` | Remove `greet`; keep builder |
| `src-tauri/tauri.conf.json` | Window title/size/min-size |

---

## 5. Verification (phase exit criteria)

1. `pnpm tauri dev` launches the app on Linux (Wayland primary) with no console errors and no Rust warnings.
2. Shell visually matches `screens/dashboard_typekernel/screen.png` chrome: top bar, surfaces, typography, scrollbar (side-by-side check).
3. All 8 screens reachable via the navigation store; each stub renders with correct breadcrumb + placeholder.
4. `pnpm build` (tsc + vite) passes clean.
5. **Offline audit:** with network fully disabled, fonts/icons/theme render identically — zero requests leave the machine (verify in devtools network tab).
6. `grep -r "greet" src src-tauri` returns nothing; no dead demo CSS/assets remain.
7. Startup to interactive shell is subjectively instant (<1s dev note; formal budget enforced in Phase 8).

---

## 6. Handoff to Phase 3

Phase 3 expects from this phase: token-complete `styles.css`, `useUiStore` (extensible), `screens/` stubs, fonts vendored, `lib/` + `content/` folders in place, sql plugin *not yet registered* (its registration, capability permission, schema and migrations are Phase 3 task 1).
