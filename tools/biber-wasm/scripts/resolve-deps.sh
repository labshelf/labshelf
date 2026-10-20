# Resolves biber's current CPAN dependency closure with cpanm and prints it in cpan-dists.txt format, for bumping biber.
# Kinds of distributions already in cpan-dists.txt are kept; new ones are printed as "new" and must be classified by hand.
. "$(dirname "$0")/common.sh"
bash "$HERE/scripts/steps/host-perl.sh"
bash "$HERE/scripts/steps/fetch-biber.sh"
lib=$BUILD/resolve-lib
rm -rf "$lib" "$HOME/.cpanm"
(cd "$BUILD/biber" && PATH=$HOSTPERL/bin:$PATH cpanm --notest --quiet -L "$lib" --installdeps . >&2) \
  || echo "cpanm reported failures (often a dependency needing system headers); check ~/.cpanm/build.log" >&2
"$HOSTPERL/bin/perl" -ne '
  BEGIN { open my $fh, "<", shift; while (<$fh>) { next if /^#/; my ($d, $k) = split; (my $n = $d) =~ s/-[^-]+$//; $kind{$n} = $k } }
  $url{$2} = $1 if m{^Fetching \S+/authors/id/(\S+/([^/]+?)\.(?:tar\.gz|tgz|zip))};
  if (/^Successfully installed (\S+)/ && !$seen{$1}++) {
    (my $n = $1) =~ s/-[^-]+$//;
    printf "%-44s %-6s %s\n", $1, $kind{$n} // "new", $url{$1};
  }' "$HERE/cpan-dists.txt" "$HOME/.cpanm/build.log"
