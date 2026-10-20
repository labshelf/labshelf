# Builds the native perl that drives the cross-build: miniperl and generate_uudmap for the wasm Configure, xsubpp and MakeMaker for the XS modules.
# It is the same perl version as the wasm one, so generated XS glue and Config-dependent .pm files match.
. "$(dirname "$0")/../common.sh"
[ -x "$HOSTPERL/bin/perl" ] && exit 0
tarball=$(fetch "https://www.cpan.org/src/5.0/perl-$PERL_VERSION.tar.gz")
dir=$(unpack "$tarball" "$BUILD/hostperl")
cd "$dir"
sh Configure -des -Dprefix="$HOSTPERL" -Dman1dir=none -Dman3dir=none >/dev/null
make -j"$JOBS" >/dev/null
make install >/dev/null
cpanm=$(fetch "https://cpan.metacpan.org/authors/id/M/MI/MIYAGAWA/App-cpanminus-$CPANM_VERSION.tar.gz")
d=$(unpack "$cpanm" "$BUILD/cpanm")
sed "1s,.*,#!$HOSTPERL/bin/perl," "$d/bin/cpanm" > "$HOSTPERL/bin/cpanm"; chmod 755 "$HOSTPERL/bin/cpanm"
