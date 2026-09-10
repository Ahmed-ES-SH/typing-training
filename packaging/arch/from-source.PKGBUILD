# TypeKernel — from-source Arch package (SCAFFOLD, untested).
#
# Plan §3.3 ships the -bin PKGBUILD as the tested path; this variant builds
# the app from a git checkout instead of repackaging the AppImage. It is
# scaffolded for future use and has NOT been through a makepkg run.
#
# Untested concerns to settle before using:
#   - node/pnpm versions pinned in makedepends match CI reality
#   - cargo home/cache handling inside makepkg's clean env
#   - `pnpm tauri build` bundling expectations when linuxdeploy is absent
#
# Usage (when validated):
#   cp -r <repo> "$srcdir/typekernel" && makepkg -f -p from-source.PKGBUILD

pkgname=typekernel-git
pkgver=1.0.0
pkgrel=1
pkgdesc='Offline coding touch-typing trainer — built from source (scaffold, untested)'
arch=('x86_64')
url='https://github.com/typekernel/typing-trainer'
license=('MIT')
depends=('gtk3' 'webkit2gtk-4.1')
makedepends=('git' 'nodejs' 'pnpm' 'rust' 'clang' 'cmake' 'file')
provides=('typekernel')
conflicts=('typekernel')
options=('!strip')

prepare() {
  cd "$srcdir/typekernel"
  pnpm install --frozen-lockfile
}

build() {
  cd "$srcdir/typekernel"
  # Tauri needs the frontend built before the Rust build
  # (tauri.conf.json -> build.beforeBuildCommand does this automatically).
  pnpm tauri build --bundles appimage
}

package() {
  # Same layout as the -bin package: launcher, resources, desktop, hicolor.
  local bin="src-tauri/target/release/typekernel"
  install -Dm755 "$bin" "$pkgdir/usr/share/typekernel/typekernel"

  install -d "$pkgdir/usr/bin"
  cat > "$pkgdir/usr/bin/typekernel" <<'EOF'
#!/bin/sh
exec /usr/share/typekernel/typekernel "$@"
EOF
  chmod 755 "$pkgdir/usr/bin/typekernel"

  install -Dm644 packaging/typekernel.desktop \
    "$pkgdir/usr/share/applications/typekernel.desktop"

  install -Dm644 src-tauri/icons/32x32.png \
    "$pkgdir/usr/share/icons/hicolor/32x32/apps/typekernel.png"
  install -Dm644 src-tauri/icons/128x128.png \
    "$pkgdir/usr/share/icons/hicolor/128x128/apps/typekernel.png"
  install -Dm644 src-tauri/icons/128x128@2x.png \
    "$pkgdir/usr/share/icons/hicolor/256x256/apps/typekernel.png"
}
