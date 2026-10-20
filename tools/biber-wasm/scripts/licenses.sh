# Writes LICENSES.txt for the build output: every component compiled into biber.wasm or packed into biber.data, with version and license.
# CPAN licenses come from each distribution's own META file, so the list follows cpan-dists.txt.
. "$(dirname "$0")/common.sh"
OUT=${1:?output file}
EMCC_VERSION=$(emcc -dumpversion)
{
  cat <<EOF
Licenses of the components bundled in biber.js, biber.wasm and biber.data.
Built by tools/biber-wasm in the LabShelf repository; the build scripts and overlay/Data/Uniqid.pm are under the repository's license (AGPL-3.0).

component                                    version        license
perl                                         $PERL_VERSION         Artistic-1.0-Perl OR GPL-1.0-or-later (https://dev.perl.org/licenses/)
biber                                        $BIBER_VERSION           Artistic-2.0 (https://github.com/plk/biber)
libxml2                                      $LIBXML2_VERSION         MIT (https://gitlab.gnome.org/GNOME/libxml2)
emscripten runtime and libc (musl)           $EMCC_VERSION         MIT OR NCSA; musl MIT; compiler-rt Apache-2.0 WITH LLVM-exception
sombok (inside Unicode-LineBreak)            2.4.0          Artistic-1.0-Perl OR GPL-1.0-or-later
btparse (inside Text-BibTeX)                 see Text-BibTeX  same as Text-BibTeX
perl hints for emscripten                    -              derived from WebPerl by Hauke Daempfling, Artistic-1.0-Perl OR GPL-1.0-or-later

CPAN distributions (license as declared in the distribution's META file):
EOF
  while read -r dist kind path; do
    case "$kind" in pp|xs) ;; *) continue ;; esac
    tarball=$SRC/$(basename "$path")
    meta=$(tar -tf "$tarball" 2>/dev/null | grep -E '^[^/]+/META\.(json|yml)$' | sort | head -1)
    license=$(tar -xOf "$tarball" "$meta" 2>/dev/null | "$HOSTPERL/bin/perl" -MCPAN::Meta -e '
      local $/; my $text = <STDIN>;
      my $meta = $ARGV[0] =~ /json$/ ? CPAN::Meta->load_json_string($text) : CPAN::Meta->load_yaml_string($text);
      print join(" OR ", $meta->licenses);' "$meta")
    if [[ $license == *unknown* ]]; then
      # Older META files say "unknown" even when the distribution text states the terms.
      if tar -xOf "$tarball" 2>/dev/null | grep -ai 'same terms as perl' >/dev/null; then license="perl_5 (stated in the distribution text)"
      else license=${license//unknown OR /}; fi
      [[ $license == *unknown* ]] && { echo "no license found for $dist; classify it by hand" >&2; exit 1; }
    fi
    printf '%-44s %-14s %s\n' "${dist%-*}" "${dist##*-}" "$license"
  done < "$HERE/cpan-dists.txt"
  echo
  echo "Data::Uniqid is replaced by overlay/Data/Uniqid.pm (counter-based ids); the CPAN original is not shipped."
} > "$OUT"
