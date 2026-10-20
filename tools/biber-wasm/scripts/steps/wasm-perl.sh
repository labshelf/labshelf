# Configures and builds perl for wasm32-emscripten: libperl.a, the static core extensions and the pure-perl library, in the build tree.
# The final executable is linked later by link.sh, once the CPAN XS archives exist.
. "$(dirname "$0")/../common.sh"
[ -f "$BUILD/wasmperl/.built" ] && exit 0
tarball=$(fetch "https://www.cpan.org/src/5.0/perl-$PERL_VERSION.tar.gz")
dir=$(unpack "$tarball" "$BUILD/wasmperl")
cd "$dir"
cp "$HERE/perl/emscripten.sh" hints/emscripten.sh

export EMPERL_HOSTPERLDIR=$BUILD/hostperl EMPERL_PREFIX=$WASM_PREFIX EMPERL_OPTIMIZE=-O2
export EMPERL_STATIC_EXT="attributes B Cwd Data/Dumper Digest/MD5 Digest/SHA Encode Encode/Byte Encode/Unicode Fcntl File/DosGlob File/Glob Filter/Util/Call Hash/Util Hash/Util/FieldHash I18N/Langinfo IO List/Util Math/BigInt/FastCalc MIME/Base64 mro Opcode PerlIO/encoding PerlIO/via POSIX re Socket Storable Sys/Hostname Time/HiRes Time/Piece Unicode/Collate Unicode/Normalize"
shim=$BUILD/configure-shim
mkdir -p "$shim"; cp "$HERE/scripts/configure-cc.sh" "$shim/emcc"
export EMCC_REAL=$(command -v emcc)
PATH=$shim:$PATH sh Configure -des -Dhintfile=emscripten > "$BUILD/wasmperl-configure.log" 2>&1 \
  || { tail -30 "$BUILD/wasmperl-configure.log"; exit 1; }
emcc -O2 -c "$HERE/perl/wasm-stubs.c" -o "$BUILD/wasm-stubs.o"
libs=$(sed -n "s/^libs='\(.*\)'$/\1/p" config.sh)
# Everything in "all" except utilities and pods, which would execute the wasm perl.
printf 'include makefile\nwasm_lib: $(PERL_EXE) $(private) $(unidatafiles) $(nonxs_ext)\n' > wasm.mk
make -f wasm.mk -j"$JOBS" libs="$libs $BUILD/wasm-stubs.o" wasm_lib > "$BUILD/wasmperl-make.log" 2>&1 || { grep -v "^@\{0,1\}emcc " "$BUILD/wasmperl-make.log" | tail -25; exit 1; }
touch .built
