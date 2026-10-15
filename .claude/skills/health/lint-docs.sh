#!/usr/bin/env bash
# Prints one line per documents/**/*.md (outside plans/) whose first line after the title does not start with "Read when ".
cd "${1:-$(git rev-parse --show-toplevel)}" || exit 2
find documents -name '*.md' -not -path 'documents/plans/*' | sort | while read -r f; do
  first=$(awk 'NR>1 && NF {print; exit}' "$f")
  case "$first" in "Read when "*) ;; *) echo "$f — first line after the title must start with 'Read when '" ;; esac
done
