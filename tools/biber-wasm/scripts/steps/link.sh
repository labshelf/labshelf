# Stages the perl tree biber needs under $WASM_PREFIX and links the static wasm perl with every XS archive into biber.js, biber.wasm and biber.data.
# Output goes to $BUILD/out.
. "$(dirname "$0")/../common.sh"
WPERL=$BUILD/wasmperl
XS=$BUILD/xs
NATLIB=$BUILD/natlib/lib/perl5
STAGE=$BUILD/stage
OUT=$BUILD/out
config() { sed -n "s/^$1='\(.*\)'$/\1/p" "$WPERL/config.sh"; }

stage_tree() {
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  (cd "$WPERL" && "$BUILD/hostperl/miniperl" installperl --destdir="$STAGE" --nopods --silent >/dev/null 2>&1)
  local root=$STAGE$WASM_PREFIX site=$STAGE$(config sitelib)
  rm -rf "$root/bin" "$root/lib/$PERL_VERSION/wasm-64int/CORE"
  mkdir -p "$site" "$root/bin"

  # Pure-perl distributions, file by file from their packlists, so build-only tools stay out.
  while read -r dist kind path; do
    [ "$kind" = pp ] || continue
    local mod=${dist%-*}
    while read -r f; do
      case "$f" in "$NATLIB"/*) ;; *) continue ;; esac
      local rel=${f#"$NATLIB"/}
      rel=${rel#aarch64-linux/}
      install -D -m 644 "$f" "$site/$rel"
    done < "$NATLIB/aarch64-linux/auto/${mod//-//}/.packlist"
  done < "$HERE/cpan-dists.txt"

  cp -r "$XS/lib/." "$site/"
  cp -r "$BUILD/biber/lib/." "$site/"
  cp -r "$HERE/overlay/." "$site/"
  install -m 755 "$BUILD/biber/bin/biber" "$root/bin/biber"

  # Documentation and build leftovers; nothing at run time reads them.
  find "$root" \( -name '*.pod' -o -name '*.a' -o -name '*.h' -o -name '.packlist' -o -name '*.bs' -o -name '*.e2x' \) -delete
  find "$root" -depth -type d \( -name pod -o -name CPAN -o -name TAP -o -name Test2 \) -exec rm -rf {} +
  rm -f "$root/lib/$PERL_VERSION/perl5db.pl" "$root"/lib/$PERL_VERSION/unicore/Test*.pl

  # biber builds dates in UTC, floating or fixed-offset zones and with DateTime's default en-US locale,
  # so the per-region zone files and the other ~1100 CLDR locales are never read.
  local tz=$site/DateTime/TimeZone
  find "$tz" -mindepth 1 -maxdepth 1 -type d ! -name Local ! -name OlsonDB -exec rm -rf {} +
  find "$site/auto/share/dist/DateTime-Locale" -name '*.pl' ! -name en.pl ! -name en-US.pl -delete
  find "$root" -depth -type d -empty -delete
}

link_biber() {
  rm -rf "$OUT"; mkdir -p "$OUT"
  cd "$BUILD"
  local exts archives=() m a
  # Legacy CJK encodings are left out: biber reads UTF-8 and the Latin code pages, and the tables are large.
  exts=$(config static_ext | tr ' ' '\n' | grep -vxE 'Encode/(CN|JP|KR|TW)' | sort -u | tr '\n' ' ')
  for m in $exts; do archives+=("$WPERL/lib/auto/$m/${m##*/}.a"); done
  while read -r m a; do exts="$exts ${m//:://}"; archives+=("$a"); done < "$XS/archives.txt"
  "$HOSTPERL/bin/perl" -MExtUtils::Miniperl -e 'writemain(\"perlmain.c", @ARGV)' DynaLoader $exts
  emcc -c -O2 $(config ccflags) -I"$WPERL" -o perlmain.o perlmain.c
  emcc -O2 -o "$OUT/biber.js" perlmain.o "$WPERL/DynaLoader.o" "${archives[@]}" "$WPERL/libperl.a" \
    "$BUILD/deps/lib/libxml2.a" "$BUILD/wasm-stubs.o" $(config libs) \
    -sMODULARIZE=1 -sEXPORT_NAME=biber -sENVIRONMENT=node,web,worker \
    -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=8MB -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 \
    -sEXPORTED_RUNTIME_METHODS=FS,ENV,callMain \
    --preload-file "$STAGE$WASM_PREFIX@$WASM_PREFIX"
}

stage_tree
link_biber
