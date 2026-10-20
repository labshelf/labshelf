# Unpacks the pinned biber release into $BUILD/biber.
. "$(dirname "$0")/../common.sh"
[ -f "$BUILD/biber/Build.PL" ] && exit 0
tarball=$(fetch "https://codeload.github.com/plk/biber/tar.gz/refs/tags/v$BIBER_VERSION" "biber-$BIBER_VERSION.tar.gz")
unpack "$tarball" "$BUILD/biber" >/dev/null
