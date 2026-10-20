# Runs every build step in order inside the toolchain container and writes the module, manifest.json and LICENSES.txt to /dist.
# Each step skips itself when its output already exists in the cache volume.
. "$(dirname "$0")/common.sh"
DIST=${DIST:-/dist}
for step in host-perl fetch-biber cpan-native wasm-perl libxml2 xs-modules link; do
  echo "== $step"
  bash "$HERE/scripts/steps/$step.sh"
done
mkdir -p "$DIST"
cp "$BUILD/out/biber.js" "$BUILD/out/biber.wasm" "$BUILD/out/biber.data" "$DIST/"
bash "$HERE/scripts/licenses.sh" "$DIST/LICENSES.txt"
bcf=$(sed -n "s/^our \$BCF_VERSION = '\(.*\)';/\1/p" "$BUILD/biber/lib/Biber/Constants.pm")
[ -n "$bcf" ] || { echo "BCF_VERSION not found in Biber/Constants.pm" >&2; exit 1; }
cd "$DIST"
"$HOSTPERL/bin/perl" -MJSON::PP -MDigest::SHA=sha256_hex -e '
  my ($biber, $bcf, @files) = @ARGV;
  my %sums = map { open my $fh, "<:raw", $_ or die "$_: $!"; local $/; ($_ => sha256_hex(<$fh>)) } @files;
  print JSON::PP->new->canonical->pretty->encode({ biber => $biber, bcfVersion => $bcf, files => \%sums });
' "$BIBER_VERSION" "$bcf" biber.js biber.wasm biber.data LICENSES.txt > manifest.json
cat manifest.json
