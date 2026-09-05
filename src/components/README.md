# src/components — shared UI components

Shell chrome and reusable pieces shared across screens.

## Icon strategy (Phase 2 decision)

- **Primary: Material Symbols Outlined** — the variable icon font is vendored
  at `public/fonts/material-symbols-outlined-variable-normal.woff2` and loaded
  via `@font-face` in `src/styles.css` (class `.material-symbols-outlined`,
  ligature-based, `FILL`/`wght`/`GRAD`/`opsz` axes available through
  `font-variation-settings`). This keeps 1:1 parity with the
  `screens/*_typekernel` designs, which use the same ligature names
  (`space_dashboard`, `bolt`, `monitor_heart`, ...).
- **`lucide-react` is available** for the rare case where an icon behaves as an
  interactive component (e.g. inline buttons needing stroke-based icons that
  inherit `currentColor` naturally); use it only when it visually matches the
  design. Icon ligature names for each screen live in `src/lib/screens.ts`.

Everything renders fully offline — no icon or font CDN links anywhere.
