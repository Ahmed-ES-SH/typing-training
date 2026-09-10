#!/usr/bin/env bash
# Rootless native install of TypeKernel (Phase 9 §3.3 companion script).
#
# Installs the AppImage payload into ~/.local in the SAME layout the pacman
# package uses system-wide (launcher, resources, desktop entry, hicolor
# icons) — full desktop integration without root:
#   ~/.local/bin/typekernel                 launcher (on PATH)
#   ~/.local/share/typekernel/              app binary + bundled libs
#   ~/.local/share/applications/typekernel.desktop
#   ~/.local/share/icons/hicolor/*/apps/typekernel.png
#
# Usage:  ./install-user.sh TypeKernel_1.0.0_amd64.AppImage
# Remove: rm -rf ~/.local/share/typekernel \
#           ~/.local/bin/typekernel \
#           ~/.local/share/applications/typekernel.desktop \
#           ~/.local/share/icons/hicolor/*/apps/typekernel.png

set -euo pipefail

APPIMAGE="${1:?usage: install-user.sh <TypeKernel_x.y.z_amd64.AppImage>}"
[ -f "$APPIMAGE" ] || { echo "no such file: $APPIMAGE" >&2; exit 1; }
APPIMAGE="$(readlink -f "$APPIMAGE")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

chmod +x "$APPIMAGE"
(cd "$WORK" && "$APPIMAGE" --appimage-extract >/dev/null)
SQ="$WORK/squashfs-root"

# The payload also contains bundled utilities (e.g. xdg-open) — pick the
# actual app binary by name, never "first non-AppRun file".
APPBIN="$(find "$SQ/usr/bin" -maxdepth 1 -type f \( -name 'typekernel' -o -name 'TypeKernel' \) -print -quit)"
[ -n "$APPBIN" ] || { echo "no app binary found in AppImage payload" >&2; exit 1; }

install -Dm755 "$APPBIN" "$HOME/.local/share/typekernel/typekernel"
if [ -d "$SQ/usr/lib" ]; then
  rm -rf "$HOME/.local/share/typekernel/lib"
  cp -a "$SQ/usr/lib" "$HOME/.local/share/typekernel/lib"
fi

install -d "$HOME/.local/bin"
cat > "$HOME/.local/bin/typekernel" <<'EOF'
#!/bin/sh
TK_HOME="$HOME/.local/share/typekernel"
export LD_LIBRARY_PATH="$TK_HOME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# The AppImage payload's webkit has its helper path patched to an AppDir-
# RELATIVE path ("././lib/webkit2gtk-4.1/...") — resolved against CWD, so
# the launcher must run from the resource dir (same trick as AppRun).
cd "$TK_HOME" || exit 1
exec "$TK_HOME/typekernel" "$@"
EOF
chmod 755 "$HOME/.local/bin/typekernel"

install -d "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/typekernel.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Version=1.0
Name=TypeKernel
GenericName=Touch Typing Trainer
Comment=Offline coding touch-typing trainer with a 260-lesson curriculum
Exec=typekernel
TryExec=typekernel
Icon=typekernel
Terminal=false
Categories=Development;Education;
StartupWMClass=typekernel
StartupNotify=true
EOF

# Icons: refresh every size the AppImage ships into the user hicolor tree.
if [ -d "$SQ/usr/share/icons/hicolor" ]; then
  find "$SQ/usr/share/icons/hicolor" -name 'typekernel.png' | while read -r icon; do
    size="$(basename "$(dirname "$(dirname "$icon")")")"
    install -Dm644 "$icon" "$HOME/.local/share/icons/hicolor/$size/apps/typekernel.png"
  done
fi

command -v update-desktop-database >/dev/null 2>&1 && \
  update-desktop-database "$HOME/.local/share/applications" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && \
  gtk-update-icon-cache -tf "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "Installed: ~/.local/bin/typekernel (launcher), desktop entry, icons."
echo "The 'TypeKernel' entry appears in your application menu (re-log or the"
echo "desktop shell may need a moment to pick it up)."
