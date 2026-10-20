#!/bin/bash
# Compares wasm biber with native TeX Live biber byte for byte on generated stress documents and on any extra .bcf given.
# Usage: test/compare.sh <distDir> [dir-with-main.bcf-and-bibs ...]; needs pdflatex and biber from TeX Live on PATH or in TEXBIN.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DIST=$(cd "$1" && pwd); shift
TEXBIN=${TEXBIN:-/usr/local/texlive/2026/bin/universal-darwin}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ms() { perl -MTime::HiRes=time -e 'printf "%d", time * 1000'; }
fail=0

# Runs native biber once and wasm biber three times on <dir>/<name>.bcf and reports identity and timings.
compare() {
  local dir=$1 name=$2 t0 t1 runs=() i
  (cd "$dir" && t0=$(ms) && "$TEXBIN/biber" --nolog --quiet --outfile="$name.native.bbl" "$name.bcf" >/dev/null && echo $(( $(ms) - t0 )) > "$name.native.ms")
  for i in 1 2 3; do
    t0=$(ms)
    node "$HERE/run-biber.cjs" "$DIST" "$dir/$name.wasm$i.bbl" "$dir/$name.bcf" "$dir"/*.bib > "$dir/$name.wasm$i.json"
    t1=$(ms); runs+=($(( t1 - t0 )))
  done
  local same=yes stable=yes
  cmp -s "$dir/$name.native.bbl" "$dir/$name.wasm1.bbl" || same=no
  cmp -s "$dir/$name.wasm1.bbl" "$dir/$name.wasm2.bbl" && cmp -s "$dir/$name.wasm1.bbl" "$dir/$name.wasm3.bbl" || stable=no
  echo "$name: entries=$(grep -c '\\entry{' "$dir/$name.native.bbl") bytes=$(wc -c < "$dir/$name.native.bbl" | tr -d ' ')" \
    "identical-to-native=$same stable-across-3=$stable native-ms=$(cat "$dir/$name.native.ms") wasm-ms=${runs[*]}" \
    "wasm-in-module=$(cat "$dir/$name.wasm1.json")"
  if [ "$same" = no ]; then diff "$dir/$name.native.bbl" "$dir/$name.wasm1.bbl" | head -20; fail=1; fi
  [ "$stable" = yes ] || fail=1
}

node "$HERE/make-fixtures.cjs" "$WORK/stress"
for doc in authoryear german; do
  (cd "$WORK/stress" && "$TEXBIN/pdflatex" -interaction=batchmode "$doc.tex" >/dev/null) || true
  compare "$WORK/stress" "$doc"
done
for extra in "$@"; do
  cp -r "$extra" "$WORK/extra-$(basename "$extra")"
  compare "$WORK/extra-$(basename "$extra")" main
done
exit $fail
