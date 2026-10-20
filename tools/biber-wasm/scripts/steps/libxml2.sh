# Cross-compiles libxml2 to a static wasm library for XML::LibXML, without network, compression or thread support.
. "$(dirname "$0")/../common.sh"
DEPS=$BUILD/deps
[ -f "$DEPS/lib/libxml2.a" ] && exit 0
tarball=$(fetch "https://download.gnome.org/sources/libxml2/${LIBXML2_VERSION%.*}/libxml2-$LIBXML2_VERSION.tar.xz")
dir=$(unpack "$tarball" "$BUILD/libxml2")
cd "$dir"
emconfigure ./configure --prefix="$DEPS" --disable-shared --enable-static --without-python --without-zlib \
  --without-lzma --without-iconv --without-icu --without-http --without-ftp --without-modules --without-threads \
  CFLAGS=-O2 > "$BUILD/libxml2.log" 2>&1
emmake make -j"$JOBS" libxml2.la >> "$BUILD/libxml2.log" 2>&1
emmake make install-libLTLIBRARIES install-data >> "$BUILD/libxml2.log" 2>&1 || { tail -20 "$BUILD/libxml2.log"; exit 1; }
