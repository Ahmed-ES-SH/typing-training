# Platform Verification — PRD §3 (Phase 9 §3.4)

**Target:** Arch Linux, Wayland primary / X11 practical.
**Stack reality:** Tauri v2 (GTK3 + WebKitGTK 4.1) — natively supports both
Wayland and X11 from the same binary; no XWayland forcing is required.

## Environment recorded

| Item | Value |
|---|---|
| OS | CachyOS (Arch-based), kernel 7.2.2-1-cachyos |
| Session at verification | Wayland (`wayland-0`) |
| App | TypeKernel 1.0.0 — `TypeKernel_1.0.0_amd64.AppImage` + `typekernel-bin 1.0.0-1` |

## Wayland (primary)

| Check | Result |
|---|---|
| Native Wayland launch (no XWayland fallback) — verify with `xlsclients` (empty) or `pgrep` + `$WAYLAND_DISPLAY` socket usage | App boots and runs under `wayland-0` ☐ confirm no XWayland entry |
| Native decorations render | ☐ |
| Fractional scaling renders crisp | ☐ |
| Keyboard capture in session screen — no key events leaking to compositor shortcuts | ☐ |
| Clipboard paste into custom-lesson form | ☐ |
| Full lesson loop (§26) | ☐ |

Automated evidence already recorded: the app launches successfully under the
Wayland session during the Phase 9 smoke tests (fresh boot, legacy-data
adoption boot, offline `unshare -rn` boot — see `offline-audit.md`).

## X11 (spot-check)

| Check | Result |
|---|---|
| Full lesson loop once (`env -C ... GDK_BACKEND=x11` or an X11 session) | ☐ |
| Decoration / keyring quirks → note in release notes | ☐ |

## Packaging-level platform deps

- `packaging/arch/PKGBUILD` declares `depends=('gtk3' 'webkit2gtk-4.1')` per
  Tauri's Arch prerequisites; all remaining libs the AppImage payloads bundle
  were verified resolvable (`ldd` clean) on the verification machine.
- Desktop entry sets `StartupWMClass=typekernel` for correct window matching
  on both backends.

## Sign-off

Wayland full pass + X11 spot-check recorded here closes PRD §3.
