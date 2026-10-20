#!/bin/bash
# Stands in for emcc while perl's Configure runs: test programs become self-contained node scripts with real file access, so Configure can execute them.
# Object files and archives pass through unchanged.
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out=$a; prev=$a; done
args=("$@")
case "$out" in
  *.o|*.a|"") ;;
  *) args+=(-sSINGLE_FILE=1 -sENVIRONMENT=node -sNODERAWFS=1 -sEXIT_RUNTIME=1) ;;
esac
"$EMCC_REAL" "${args[@]}" || exit $?
case "$out" in
  *.o|*.a|"") ;;
  *) if [ -f "$out" ] && ! head -c2 "$out" | grep -q '#!'; then
       { echo '#!/usr/bin/env node'; cat "$out"; } > "$out.tmp" && mv "$out.tmp" "$out" && chmod +x "$out"
     fi ;;
esac
