# Compiles every "xs" distribution of cpan-dists.txt into a static wasm archive, using the distribution's own Makefile.PL so its DEFINEs survive.
# Writes the archives to $XS/archives.txt (module, archive) for link.sh and the .pm files to $XS/lib.
. "$(dirname "$0")/../common.sh"
XS=$BUILD/xs
WPERL=$BUILD/wasmperl
NATLIB=$BUILD/natlib/lib/perl5
DEPS=$BUILD/deps
[ -f "$XS/.done" ] && exit 0
rm -rf "$XS"; mkdir -p "$XS/lib"
: > "$XS/archives.txt"; : > "$XS/defines.txt"
export PATH=$HOSTPERL/bin:$PATH PERL5LIB=$NATLIB PERL_MM_USE_DEFAULT=1
WCCFLAGS=$(sed -n "s/^ccflags='\(.*\)'$/\1/p" "$WPERL/config.sh")
TYPEMAP=$HOSTPERL/lib/$PERL_VERSION/ExtUtils/typemap

# Builds through MakeMaker with the compiler, flags and headers swapped for the wasm ones.
build_makemaker() {
  local dir=$1 mod=$2 extra_cflags=${3:-} inc=${4:-}
  cd "$dir"
  perl Makefile.PL LINKTYPE=static > build.log 2>&1
  echo "$mod $(sed -n 's/^DEFINE = //p' Makefile)" >> "$XS/defines.txt"
  local args=(LINKTYPE=static CC=emcc LD=emcc AR=emar FULL_AR=emar RANLIB=emranlib CCCDLFLAGS= OPTIMIZE=-O2
    "CCFLAGS=$WCCFLAGS $extra_cflags" "PERL_INC=$WPERL")
  [ -n "$inc" ] && args+=("INC=$inc")
  make "${args[@]}" >> build.log 2>&1 || { tail -20 build.log; exit 1; }
  collect "$dir" "$mod"
}

# Compiles one .xs plus companion C files by hand, for distributions that build with Module::Build.
build_manual() {
  local dir=$1 mod=$2 version=$3 xs=$4 cflags=$5; shift 5
  cd "$dir"
  local c=${xs%.xs}.c tm=() objs=()
  [ -f typemap ] && tm=(-typemap "$PWD/typemap")
  perl "$HOSTPERL/lib/$PERL_VERSION/ExtUtils/xsubpp" -noprototypes -typemap "$TYPEMAP" "${tm[@]}" "$xs" > "$c"
  echo "$mod $cflags" >> "$XS/defines.txt"
  for src in "$c" "$@"; do
    emcc -c -O2 $WCCFLAGS -I"$WPERL" $cflags -DVERSION="\"$version\"" -DXS_VERSION="\"$version\"" \
      -o "${src%.c}.o" "$src" || exit 1
    objs+=("${src%.c}.o")
  done
  local auto=blib/arch/auto/${mod//:://}
  mkdir -p "$auto" blib/lib
  emar rcs "$auto/${mod##*::}.a" "${objs[@]}"
  cp -r lib/. blib/lib/
  collect "$dir" "$mod"
}

collect() {
  local dir=$1 mod=$2 a
  a=$dir/blib/arch/auto/${mod//:://}/${mod##*::}.a
  [ -n "$(emar t "$a")" ] || { echo "empty archive for $mod" >&2; exit 1; }
  echo "$mod $a" >> "$XS/archives.txt"
  cp -r "$dir/blib/lib/." "$XS/lib/"
  [ -d "$dir/blib/arch" ] && (cd "$dir/blib/arch" && find . -name '*.pm' -exec cp --parents {} "$XS/lib/" \;)
  true
}

while read -r dist kind path; do
  [ "$kind" = xs ] || continue
  dir=$(unpack "$SRC/$(basename "$path")" "$XS/$dist")
  version=${dist##*-}
  case "$dist" in
    Text-BibTeX-*)
      sed -e 's/#\[% ALLOCA_H %\]/#define HAVE_ALLOCA_H 1/' -e 's/#\[% VSNPRINTF %\]/#define HAVE_VSNPRINTF 1/' \
          -e 's/#\[% STRLCAT %\]/#define HAVE_STRLCAT 1/' -e 's/\[% PACKAGE %\]/"libbtparse"/' \
          -e "s/\[% FPACKAGE %\]/\"libbtparse $version\"/" -e "s/\[% VERSION %\]/\"$version\"/" \
          "$dir/btparse/src/bt_config.h.in" > "$dir/btparse/src/bt_config.h"
      grep -q '\[%' "$dir/btparse/src/bt_config.h" && { echo "unfilled bt_config.h placeholder" >&2; exit 1; }
      build_manual "$dir" Text::BibTeX "$version" xscode/BibTeX.xs "-Ibtparse/src -D_FORTIFY_SOURCE=1" \
        xscode/btxs_support.c $(cd "$dir" && ls btparse/src/*.c) ;;
    Params-Validate-*)
      build_manual "$dir" Params::Validate::XS "$version" lib/Params/Validate/XS.xs "-Ic" ;;
    XML-LibXML-*)
      build_makemaker "$dir" XML::LibXML "" "-I$DEPS/include/libxml2" ;;
    PerlIO-utf8_strict-*)
      # TRAP: the module defines a non-static PerlIOBase_flush_linebuf, which collides with perl's own in a static link.
      build_makemaker "$dir" PerlIO::utf8_strict "-DPerlIOBase_flush_linebuf=utf8_strict_flush_linebuf" ;;
    *)
      build_makemaker "$dir" "$(perl -e '$_=shift; s/-[^-]*$//; s/-/::/g; print' "$dist")" ;;
  esac
  echo "built $dist"
done < "$HERE/cpan-dists.txt"
touch "$XS/.done"
