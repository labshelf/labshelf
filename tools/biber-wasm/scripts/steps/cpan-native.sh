# Installs the pinned CPAN closure (pp, xs, build) into a native local lib: the pure-perl files that get shipped come from here, and Module::Build and friends serve the XS builds.
# cpanm may not resolve anything on its own: an unpinned dependency fails the build instead of pulling a new version.
. "$(dirname "$0")/../common.sh"
NATLIB=$BUILD/natlib
[ -f "$NATLIB/.done" ] && exit 0
files=()
while read -r dist kind path; do
  case "$dist" in ''|\#*) continue ;; esac
  [ "$kind" = skip ] && continue
  files+=("$(fetch "https://cpan.metacpan.org/authors/id/$path")")
done < "$HERE/cpan-dists.txt"
PATH=$HOSTPERL/bin:$PATH cpanm --notest --quiet --no-man-pages --mirror "file://$BUILD/no-mirror" --mirror-only \
  -L "$NATLIB" "${files[@]}" > "$BUILD/cpan-native.log" 2>&1 || { tail -30 "$BUILD/cpan-native.log"; exit 1; }
touch "$NATLIB/.done"
