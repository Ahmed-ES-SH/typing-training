# AUR Submission Checklist (post-1.0, per PRD §3 "AUR — later")

Phase 9 ships only this scaffold; nothing below has been done yet.

## Prerequisites
- [ ] GitHub repo is public; `v1.0.0` release tagged and pushed.
- [ ] Release asset `TypeKernel_1.0.0_amd64.AppImage` uploaded to the release.
- [ ] A LICENSE file exists in the repo and the PKGBUILD `license=` matches.
- [ ] Decide AUR package name: `typekernel-bin` (recommended) vs `typekernel`.

## Before submitting
- [ ] Fill `sha256sums` via `updpkgsums` (SKIP is rejected for remote sources).
- [ ] Regenerate `.SRCINFO`: `makepkg --printsrcinfo > .SRCINFO`.
- [ ] Build cleanly in a pristine chroot: `aur chroot` / `extra-x86_64-build`.
- [ ] `namcap PKGBUILD` — fix reported warnings.
- [ ] Verify `pacman -Ql typekernel-bin` shows only: `/usr/bin/typekernel`,
      `/usr/share/typekernel/*`, the desktop entry, hicolor icons.
- [ ] Verify `pacman -R typekernel-bin` removes everything cleanly.

## Submission
- [ ] `git clone ssh://aur@aur.archlinux.org/typekernel-bin.git`
- [ ] Copy PKGBUILD + .SRCINFO in, commit with a summary line matching
      `pkgname: pkgver, pkgrel — reason`, push to `master`.
- [ ] Post-submit: install from AUR, confirm first boot adopts pre-1.0 dev
      data (Phase 9 §3.1) and the app is fully usable offline.

## Maintenance
- [ ] Bump `pkgver`/`pkgrel`, update checksums and `.SRCINFO` per release
      (see `docs/release/RELEASE_CHECKLIST.md`).
