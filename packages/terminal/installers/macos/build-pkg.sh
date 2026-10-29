#!/bin/bash
# Builds labshelf-helper-macos.pkg, a current-user installer that lays the helper into its data folder's bin/ and registers it, with an optional choice that installs Python.
# Usage: build-pkg.sh <helper binary> <version> <output dir>
set -euo pipefail

binary="${1:?usage: build-pkg.sh <helper binary> <version> <output dir>}"
version="${2:?missing version}"
out="${3:?missing output dir}"
here="$(cd "$(dirname "$0")" && pwd)"
arch="$(lipo -archs "$binary")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/payload" "$out"
cat "$binary" > "$work/payload/labshelf-helper"
chmod 755 "$work/payload/labshelf-helper"
cp -R "$here/scripts" "$work/scripts"
# PLATFORM: extended attributes of the input (quarantine, provenance) would travel as ._ AppleDouble files in the payload, so the payload gets a fresh copy.
# The install location is absolute so the current-user-home domain maps it below ~.
pkgbuild --root "$work/payload" \
  --identifier dev.labshelf.helper --version "$version" \
  --install-location "/Library/Application Support/LabShelf Helper/bin" \
  --scripts "$work/scripts" "$work/component.pkg"
# The optional "Python for calculations" choice: no payload, its postinstall runs the helper's --install-python after the helper package.
pkgbuild --nopayload --identifier dev.labshelf.helper.python --version "$version" \
  --scripts "$work/scripts" "$work/python.pkg"

sed -e "s/VERSION/$version/" -e "s/HOST_ARCH/$arch/" "$here/distribution.xml" > "$work/distribution.xml"
productbuild --distribution "$work/distribution.xml" --resources "$here/resources" --package-path "$work" "$out/labshelf-helper-macos.pkg"
