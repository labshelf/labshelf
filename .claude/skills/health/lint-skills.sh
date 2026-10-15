#!/usr/bin/env bash
# Lints the agent and skill definitions under .claude/ and prints one "path — rule" line per violation.
cd "$(git rev-parse --show-toplevel)" || exit 2
bad=0
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
history='no longer|previously|used to|legacy|formerly|was replaced'
flag() { echo "$1 — $2"; bad=1; }

# Value of a frontmatter key, empty when absent.
fm() { awk -v k="$2" '/^---$/ {n++; next} n==1 && index($0, k ":")==1 {sub(/^[^:]*: */, ""); print; exit}' "$1"; }

for f in .claude/agents/*.md; do
  [ -n "$(fm "$f" name)" ] || flag "$f" "frontmatter name missing"
  [ -n "$(fm "$f" description)" ] || flag "$f" "frontmatter description missing"
  model=$(fm "$f" model)
  # Agents without a model run on Sonnet (CLAUDE.md), so only unknown values are flagged.
  if [ -n "$model" ] && ! echo "$model" | grep -qE '^(haiku|sonnet|opus|fable|inherit)$'; then
    flag "$f" "unknown model '$model'"
  fi
  [ "$(wc -l < "$f")" -le 65 ] || flag "$f" "over 65 lines"
done

for f in .claude/skills/*/SKILL.md; do
  dir=$(basename "$(dirname "$f")")
  name=$(fm "$f" name)
  [ -n "$name" ] || flag "$f" "frontmatter name missing"
  [ -z "$name" ] || [ "$name" = "$dir" ] || flag "$f" "name '$name' differs from folder '$dir'"
  [ -n "$(fm "$f" description)" ] || flag "$f" "frontmatter description missing"
  [ "$(wc -l < "$f")" -le 110 ] || flag "$f" "over 110 lines"
done

for f in .claude/agents/*.md .claude/skills/*/SKILL.md; do
  base=$(dirname "$f")
  grep -oE '`[^` ]+`' "$f" | tr -d '`' | grep -E '^(\.claude/|documents/|scripts/|references/)' \
    | grep -vE '[*<>{}$…]' | sed -E 's/#.*$//; s/[.,:;)]+$//' | sort -u > "$tmp"
  while read -r p; do
    case "$p" in references/*) p="$base/$p" ;; esac
    [ -e "$p" ] || flag "$f" "referenced path '$p' does not exist"
  done < "$tmp"
  # Phrases inside double quotes are rule definitions, not prose, so they are stripped first.
  while IFS=: read -r n line; do
    echo "$line" | sed -E 's/"[^"]*"//g' | grep -qiE "$history" && flag "$f:$n" "history language"
  done < <(grep -n . "$f")
done
exit $bad
