#!/usr/bin/env bash
# Generate Bastion's app icons from bastion.svg (no Xcode needed):
#   resources/build/icon.png  (1024, Linux + fallback)   resources/build/icon.ico  (Windows)
#   resources/build/icon.icns (macOS)                    resources/icon.png, icon-dev.png (in-app)
#   resources/tray/*Template*.png (menu-bar silhouette)
# Tools come from nix: librsvg (rsvg-convert), imagemagick, libicns (png2icns).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES="$(dirname "$SCRIPT_DIR")"
SVG="$SCRIPT_DIR/bastion.svg"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for size in 16 32 48 64 128 256 512 1024; do
  rsvg-convert -w "$size" -h "$size" "$SVG" -o "$TMP/icon-$size.png"
done

cp "$TMP/icon-1024.png" "$RESOURCES/build/icon.png"
cp "$TMP/icon-512.png" "$RESOURCES/icon.png"
cp "$TMP/icon-512.png" "$RESOURCES/icon-dev.png"
magick "$TMP/icon-16.png" "$TMP/icon-32.png" "$TMP/icon-48.png" "$TMP/icon-64.png" \
  "$TMP/icon-128.png" "$TMP/icon-256.png" "$RESOURCES/build/icon.ico"
png2icns "$RESOURCES/build/icon.icns" "$TMP/icon-16.png" "$TMP/icon-32.png" \
  "$TMP/icon-128.png" "$TMP/icon-256.png" "$TMP/icon-512.png" "$TMP/icon-1024.png"

# The macOS menu bar wants a black-on-clear template image: the host's silhouette.
cat > "$TMP/tray.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="34 26 64 80">
  <path fill-rule="evenodd" fill="#000" d="M40 40 L72 30 L92 40 L92 90 L60 100 L40 90 Z M76 56 L86 60 V68 C86 75 81 79 76 82 C71 79 66 75 66 68 V60 Z"/>
</svg>
EOF
rsvg-convert -w 16 -h 20 "$TMP/tray.svg" -o "$RESOURCES/tray/orca-menu-barTemplate.png"
rsvg-convert -w 32 -h 40 "$TMP/tray.svg" -o "$RESOURCES/tray/orca-menu-barTemplate@2x.png"
echo "Icons written from $SVG"
