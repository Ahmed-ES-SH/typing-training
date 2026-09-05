# PHASE 9 PLAN — Packaging & Distribution

**Parent:** [MAIN_PLAN.md](./MAIN_PLAN.md) → Phase 9
**PRD sections covered:** §3 (Target Platform — Arch Linux primary, Wayland primary / X11 practical), §5 (Offline Requirement — final audit), §27 (Final Product Definition — the ship checklist)
**Depends on:** Phase 8 exit criteria met (release candidate, perf evidence, PRD checklist green)
**Status:** Planned — not started. Implementation contract for Phase 9 only.

---

## 1. Goal

Ship it: TypeKernel branding and window polish, production builds as **AppImage** and an Arch **`.pkg.tar.zst`**, verified installed on Arch (Wayland primary, X11 spot-check), a final **offline audit**, and the release scaffolding for a later AUR package (PRD §3 lists AUR as "later" — scaffold only here).

**Explicitly out of scope:** auto-updates (PRD allows internet *only* for manual update checks/downloading newer releases — Phase 7's manual "Check for Updates" stays the mechanism; no updater service is built), AUR publication itself (scaffold + local makepkg only), Windows/macOS.

---

## 2. Design Decisions (fixed before coding)

| Topic | Decision | Rationale |
|---|---|---|
| App identity | `productName: "TypeKernel"`, identifier `com.typekernel.app` (replacing the template's `com.adev.typing-trainer` — changing **before** first release since the identifier keys the app-data dir; DB path migration handled by a first-boot check that adopts the old dir if present) | §27 defines the product as TypeKernel; identifier must be final before anything ships |
| Icons | Full Tauri icon set generated (`tauri icon`) from a single TypeKernel source glyph (orange bracket/terminal motif on surface dark) — all sizes + `tray`/`category` metadata in `.desktop` | Bundle config needs the complete set; design language already established |
| Bundle targets | `tauri build` targets: **AppImage** (primary distributable) + **dir** (feeds the Arch package); deb/rpm **disabled** | PRD §3 candidates: Arch pkg + AppImage; deb/rpm are noise for an Arch-first product |
| Arch package | `packaging/arch/PKGBUILD` (**-bin style**): repackages the AppImage payload into a native layout (`/usr/bin/typekernel` launcher, `/usr/share/typekernel` resources, `.desktop` + icons via hicolor dirs), builds `typekernel-<ver>-1-x86_64.pkg.tar.zst` via `makepkg -f`; a from-source PKGBUILD variant is scaffolded but untested | Native pacman integration without dragging users through AppImage extraction; -bin is deterministic and matches "lightweight native feel" (§3) |
| AUR (later) | `packaging/aur/` scaffold: PKGBUILD + .SRCINFO template + submission checklist doc — not published | PRD: AUR "later" |
| Wayland/X11 | Tauri v2 (GTK/WebKitGTK) runs both; verify: native Wayland launch (no XWayland fallback), X11 session spot-check; WebKitGTK runtime deps declared in PKGBUILD (`webkit2gtk-4.1`, `gtk3`, etc. per Tauri's Arch prerequisites) | §3 platform statement |
| Offline audit (§5) | Automated + manual: network namespace isolation (`unshare -n`) launch of the **installed** package → complete a lesson, run a weakness drill, export/import, reset — plus devtoolsNetwork assertion in dev builds; the only network-touching code path (manual update check) must no-op gracefully offline | §5 "fully usable with no internet access" is the product's core claim |
| Data location | DB + backups under `$XDG_DATA_HOME/typekernel/` (Tauri app-data dir), settings follow; package ships **no** user data | Linux convention; reset/backup flows (Phase 7) already use app-data |
| Versioning | `0.1.0` → `1.0.0` at this phase across `package.json`, `Cargo.toml`, `tauri.conf.json`, PKGBUILD; release notes generated from phase docs | Single source version bump; phases 2–8 docs become the changelog |
| Desktop integration | `.desktop` (WMClass matches binary), StartupWMClass set, `Categories=Development;Education;`, MIME assoc none, single-instance behavior | Native-feel requirement (§3) |

---

## 3. Tasks

### 3.1 Branding & identity
- Final TypeKernel logo glyph (SVG) → `tauri icon` full set; update `tauri.conf.json` (`productName`, identifier, window title, bundle icon list); favicon (Phase 2 placeholder) replaced by the same glyph.
- First-boot adoption: if the legacy identifier's data dir exists (dev installs), migrate it to the new one; test both fresh and adopted boots.

### 3.2 Build pipeline
- Release build: `pnpm tauri build` → AppImage + dir artifacts; verify `beforeBuildCommand` (tsc + vite) runs in CI-equivalent clean state; artifact naming `TypeKernel_<ver>_amd64.AppImage`.
- Smoke matrix on artifacts: fresh DB boot, migration path boot (copy a Phase ≤ 7-era DB forward), oversized lesson import, reset flow.

### 3.3 Arch package
- Write `packaging/arch/PKGBUILD` (+ `.SRCINFO` gen): depends = WebKitGTK/GTK runtime set per Tauri Arch docs; `package()` installs launcher, resources, .desktop, icons; `makepkg -f` → `.pkg.tar.zst`.
- `pacman -U` install test (in a clean chroot or accept local install with `--noconfirm` + documented rollback): binary launches from PATH, desktop entry appears, icons resolve, uninstall removes everything (verify with `pacman -Ql` / `pacman -R`).

### 3.4 Platform verification (§3)
- **Wayland (primary):** launch under real Wayland session — check native decorations, fractional scaling, keyboard capture in session screen (no key events leaking to compositor shortcuts), clipboard paste into custom-lesson form.
- **X11 (spot-check):** full lesson loop once; note any decoration/keyring quirks in release notes.
- Record results in `docs/release/platform-verification.md`.

### 3.5 Offline audit (§5, final)
- `unshare -n` launch of installed AppImage **and** pacman package: complete a real lesson, drill, custom-lesson create/export/import, settings changes, reset — zero functionality loss.
- Code audit: `grep`-level confirmation that the only outbound-capable path is the manual update check (opener on a URL) and it fails silently-but-clearly offline.
- Evidence recorded in `docs/release/offline-audit.md` (§27 "fully offline during normal operation").

### 3.6 Release scaffolding
- `CHANGELOG.md` (phases 1–8 summarized), `README.md` rewrite (real screenshots from `screens/*/screen.png`, install instructions: AppImage chmod+run, `pacman -U`, AUR-later note, offline statement, build-from-source), `docs/release/RELEASE_CHECKLIST.md` (per-release steps incl. version bump locations, icon regen, artifact smoke matrix).
- `packaging/aur/` scaffold per §2.
- Tag `v1.0.0` locally (no remote publish from here — distribution is the user's call).

---

## 4. File Change Summary

| File | Change |
|---|---|
| `src-tauri/tauri.conf.json` | productName/identifier/title/icons/bundle targets (AppImage + dir only) |
| `src-tauri/icons/*` | Full generated set from final glyph |
| `src-tauri/src/lib.rs` | Data-dir adoption check (first boot) |
| `packaging/arch/PKGBUILD`, `.SRCINFO` | New — -bin repack producing `.pkg.tar.zst` |
| `packaging/arch/from-source.PKGBUILD` | New — scaffold, untested |
| `packaging/aur/*` | New — future submission scaffold |
| `public/icons/favicon.svg`, `index.html` | Final branding |
| `README.md`, `CHANGELOG.md` | Real content (was template) |
| `docs/release/*` | Verification evidence + release checklist |

---

## 5. Verification (phase exit criteria)

1. `pnpm tauri build` produces a working AppImage: launched from a clean $HOME (sandboxed XDG dirs), completes the full §26 lesson loop.
2. `makepkg -f` → `pacman -U` → launcher/desktop/icons correct; `pacman -R` clean; package contents audited (`pacman -Ql`) — no stray dev files, no bundled user data.
3. Platform matrix recorded: Wayland full pass (native, scaling, keyboard), X11 pass with notes.
4. **Offline audit (§5)** passes on both artifacts with network namespace isolation — PRD §5 signed off in `docs/release/offline-audit.md`.
5. Migration path: a pre-1.0 dev DB boots under the released build with zero data loss (lessons, attempts, stats, settings intact).
6. Version/identity coherence: identifier, productName, window title, .desktop, PKGBUILD all say TypeKernel 1.0.0; `grep -ri "adev\|typing-trainer" src-tauri packaging` clean of template leftovers.
7. Release checklist + changelog complete; AUR scaffold present but unpublished (per PRD "later").

---

## 7. Ship Gate

With all boxes green, PRD §27's definition is met point-for-point: offline Arch-first Linux desktop trainer on the mandated stack, 260-lesson curriculum with programming-symbol focus, unlock-gated progression, attempt-level history, adaptive/heatmap/weakness intelligence, custom lessons with validated import/export, daily consistency tracking — local persistence only, no backend, no accounts, no cloud. Post-1.0 backlog (AUR submission, extra layouts, updater improvements) is handed off as a document, not a promise.
