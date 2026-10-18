#!/bin/bash
# Builds labshelf-helper-linux.deb (system-wide, with native-messaging manifests for every browser) and labshelf-helper-linux.tar.gz (per-user, registered by hand).
# Usage: build-linux.sh <helper binary> <version> <output dir> <deb architecture: amd64|arm64>
set -euo pipefail

binary="${1:?usage: build-linux.sh <helper binary> <version> <output dir> <amd64|arm64>}"
version="${2:?missing version}"
out="${3:?missing output dir}"
arch="${4:?missing deb architecture}"
here="$(cd "$(dirname "$0")" && pwd)"
origins_source="$here/../../src/helper/register/allowedOrigins.ts"
host="dev.labshelf.helper"
install_dir="/usr/lib/labshelf-helper"

# The extension ids live in one place, the register module the user-level --register also reads.
chrome_origin="$(grep -o 'chrome-extension://[a-p]*/' "$origins_source")"
firefox_extension="$(grep -o '"[^"]*@[^"]*"' "$origins_source" | tr -d '"')"
[ -n "$chrome_origin" ] && [ -n "$firefox_extension" ] || { echo "no extension id found in $origins_source" >&2; exit 1; }

manifest() { # <family: chromium|firefox>
  local allowed
  if [ "$1" = firefox ]; then allowed="\"allowed_extensions\": [\"$firefox_extension\"]"; else allowed="\"allowed_origins\": [\"$chrome_origin\"]"; fi
  printf '{\n  "name": "%s",\n  "description": "LabShelf Helper",\n  "path": "%s/labshelf-helper",\n  "type": "stdio",\n  %s\n}\n' "$host" "$install_dir" "$allowed"
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

# PLATFORM: browsers read system-wide hosts from these directories; dpkg owns the files, so removing the package removes the registration.
pkg="$work/deb"
install -d "$pkg/DEBIAN" "$pkg$install_dir"
install -m 755 "$binary" "$pkg$install_dir/labshelf-helper"
for dir in /etc/opt/chrome /etc/chromium /etc/opt/edge; do
  install -d "$pkg$dir/native-messaging-hosts"
  manifest chromium > "$pkg$dir/native-messaging-hosts/$host.json"
done
install -d "$pkg/usr/lib/mozilla/native-messaging-hosts"
manifest firefox > "$pkg/usr/lib/mozilla/native-messaging-hosts/$host.json"
find "$pkg" -name '*.json' -exec chmod 644 {} +
sed -e "s/@VERSION@/$version/" -e "s/@ARCH@/$arch/" "$here/control" > "$pkg/DEBIAN/control"
dpkg-deb --build --root-owner-group "$pkg" "$out/labshelf-helper-linux.deb"

tarball="$work/tar"
install -d "$tarball/labshelf-helper"
install -m 755 "$binary" "$tarball/labshelf-helper/labshelf-helper"
install -m 644 "$here/README.txt" "$tarball/labshelf-helper/README.txt"
tar -C "$tarball" -czf "$out/labshelf-helper-linux.tar.gz" labshelf-helper
