# Release Checklist (per release)

## 1. Version bump — all four locations must agree

| Location | Field |
|---|---|
| `package.json` | `version` |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `packaging/arch/PKGBUILD` (+ `packaging/aur/PKGBUILD`) | `pkgver` (bump `pkgrel` to 1 on pkgver change, +1 otherwise) |

Then: `pnpm install` (lockfile refresh if needed) and `cargo check` once in
`src-tauri/` to regenerate `Cargo.lock`.

## 2. Icons (only if the glyph changed)

```sh
pnpm tauri icon packaging/icons/typekernel.svg
# favicon.svg under public/icons/ is maintained by hand to match the glyph
```

## 3. Build

```sh
export APPIMAGE_EXTRACT_AND_RUN=1   # needed on hosts without FUSE2
pnpm tauri build --bundles appimage
# → src-tauri/target/release/bundle/appimage/TypeKernel_<ver>_amd64.AppImage
```

> If bundling fails with `failed to run linuxdeploy` on bleeding-edge Arch
> systems: the pinned linuxdeploy cannot strip libs with `.relr.dyn`
> sections. Update `~/.cache/tauri/linuxdeploy-x86_64.AppImage` from
> <https://github.com/linuxdeploy/linuxdeploy/releases> (continuous) and retry.

## 4. Smoke matrix (every artifact)

1. **Fresh boot** — clean XDG dirs (`XDG_DATA_HOME`/`XDG_CONFIG_HOME`/`HOME`
   pointed at temp dirs): app boots, DB created under
   `<config>/com.typekernel.app/`.
2. **Migration boot** — move a pre-1.0 DB dir into
   `<config>/com.adev.typing-trainer/`, clear the new dir, boot: data
   adopted into `com.typekernel.app`, legacy copy left untouched.
3. **Oversized custom-lesson import** — §17 limits enforced with a clear error.
4. **Reset flow** — wipes DB, app returns to first-boot state.

## 5. Arch package

```sh
cd packaging/arch
cp ../../src-tauri/target/release/bundle/appimage/TypeKernel_<ver>_amd64.AppImage .
updpkgsums                # fill sha256sums
makepkg -f                # → typekernel-bin-<ver>-1-x86_64.pkg.tar.zst
makepkg --printsrcinfo > .SRCINFO
sudo pacman -U typekernel-bin-<ver>-1-x86_64.pkg.tar.zst
pacman -Ql typekernel-bin  # audit: launcher, /usr/share/typekernel, desktop, hicolor icons only
pacman -R typekernel-bin   # clean removal
```

> The `/usr/bin/typekernel` launcher does two non-obvious things (see the
> PKGBUILD comments): it sets `LD_LIBRARY_PATH` to the bundled libs, and it
> `cd`s into `/usr/share/typekernel` before exec — the payload's WebKitGTK
> helpers are referenced via an AppDir-RELATIVE path that only resolves from
> the resource dir. Removing either line breaks app boot with
> `Failed to spawn child process .../WebKitNetworkProcess`.
>
> Rootless alternative with identical desktop integration:
> `packaging/arch/install-user.sh TypeKernel_<ver>_amd64.AppImage`
> (installs to `~/.local/{bin,share}` — no pacman ownership).

## 6. Offline + platform sign-off (per release, PRD §3 + §5)

- Re-run the `unshare -rn` boot test from `docs/release/offline-audit.md`;
  re-record the manual offline session matrix.
- Update `docs/release/platform-verification.md` (Wayland pass, X11 spot-check).

## 7. Release housekeeping

- Update `CHANGELOG.md` (keep phases 1–8 summary on top, add the new
  version section).
- Tag: `git tag vX.Y.Z` (distribution/publishing is a separate, manual step).
- If publishing to GitHub Releases: upload `TypeKernel_<ver>_amd64.AppImage`
  as `TypeKernel_<ver>_amd64.AppImage` (the AUR scaffold's `source=` URL
  pattern depends on this exact name).
- AUR (when the time comes): follow `packaging/aur/SUBMISSION_CHECKLIST.md`.
