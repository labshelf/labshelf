# Shared paths and the checksum-verified download helper for the in-container build steps.
# Sourced by every script in this folder.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$HERE/versions.sh"
CACHE=${CACHE:-/cache}
SRC=$CACHE/src
BUILD=$CACHE/build
HOSTPERL=$CACHE/hostperl
LOCK=$HERE/sources.lock
JOBS=${JOBS:-$(nproc)}
mkdir -p "$SRC" "$BUILD"

# Downloads <url> to $SRC/<name> once and checks it against sources.lock; unknown files are appended to the lock.
fetch() {
  local url=$1 name=${2:-$(basename "$1")} want got
  local dest=$SRC/$name
  [ -f "$dest" ] || curl -fsSL --retry 3 -o "$dest.part" "$url" && { [ -f "$dest" ] || mv "$dest.part" "$dest"; }
  got=$(sha256sum "$dest" | cut -d' ' -f1)
  want=$(awk -v n="$name" '$1 == n { print $2 }' "$LOCK" 2>/dev/null || true)
  if [ -z "$want" ]; then
    echo "$name $got $url" >> "$LOCK"
  elif [ "$want" != "$got" ]; then
    echo "checksum mismatch for $name: expected $want, got $got" >&2; exit 1
  fi
  echo "$dest"
}

# Extracts a tarball into a fresh directory and prints its path.
unpack() {
  local tarball=$1 dest=$2
  rm -rf "$dest"; mkdir -p "$dest"
  tar -xf "$tarball" -C "$dest" --strip-components=1
  echo "$dest"
}
