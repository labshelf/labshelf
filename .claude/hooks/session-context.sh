#!/usr/bin/env bash
# SessionStart hook: prints a few lines of repo state (branch, uncommitted work, active plans)
# so the model knows where things stand without reading files. Plain stdout becomes context.
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0

branch=$(git branch --show-current 2>/dev/null)
status=$(git status --porcelain 2>/dev/null)
changed=$(printf '%s\n' "$status" | grep -c '^ \?[MADRC]')
untracked=$(printf '%s\n' "$status" | grep -c '^??')
areas=$(printf '%s\n' "$status" | awk '{print $NF}' | awk -F/ '$1=="packages"{print $1"/"$2; next} {print $1}' | sort | uniq -c | sort -rn | head -5 | awk '{printf "%s%s (%s)", sep, $2, $1; sep=", "}')

echo "LabShelf session context (from .claude/hooks/session-context.sh):"
echo "- Branch: ${branch:-detached} · uncommitted: ${changed} changed, ${untracked} untracked${areas:+ · most changes in: $areas}"

plans=$(find documents/plans -maxdepth 1 -name '*.plan.md' 2>/dev/null | sort)
if [ -z "$plans" ]; then
  echo "- Active plans: none"
else
  echo "- Active plans (open/total checklist items):"
  for p in $plans; do
    open=$(grep -c '\[ \]' "$p"); done_=$(grep -ci '\[x\]' "$p")
    state=$(grep -m1 -E '^Status:' "$p" | sed 's/^Status: *//')
    next=$(grep -m1 -E '\[ \]' "$p" | sed -E 's/^[[:space:]|-]*//; s/\[ \][[:space:]]*//' | cut -c1-90)
    echo "  - $p: $open/$((open + done_)) open${state:+ · status: $state}${next:+ · next: $next}"
  done
fi

# Memory lint: flag memory entries whose linked file is missing, and repo paths
# named in memory files that no longer exist.
slug=$(printf '%s' "$root" | tr '/' '-')
mem_dir="$HOME/.claude/projects/$slug/memory"
mem_md="$mem_dir/MEMORY.md"
if [ -f "$mem_md" ]; then
  while IFS= read -r entry_line; do
    case "$entry_line" in
      "- ["*)
        title=$(printf '%s' "$entry_line" | sed -E 's/^- \[([^]]*)\].*/\1/')
        mdfile=$(printf '%s' "$entry_line" | sed -E 's/^- \[[^]]*\]\(([^)]*)\).*/\1/')
        [ -n "$mdfile" ] || continue
        [ -f "$mem_dir/$mdfile" ] || echo "STALE?: $title -> $mdfile (missing memory file)"
        ;;
    esac
  done < "$mem_md"

  # Only tokens rooted at a real top-level directory are checked; a shorthand
  # fragment like `ui/styles/tokens.css` (relative to some package's src/) is
  # not a repo-root path and would false-positive on every memory.
  for memfile in "$mem_dir"/*.md; do
    [ -f "$memfile" ] || continue
    while IFS= read -r token; do
      token=${token%%\**}; token=${token%.}; token=${token%/}
      [ -n "$token" ] || continue
      [ -e "$root/$token" ] || echo "STALE?: $(basename "$memfile") -> $token"
    done < <(grep -oE '(packages|documents|scripts|website|credentials|test-workspace|\.claude)/[A-Za-z0-9_.*/-]+' "$memfile" | sort -u)
  done
fi
exit 0
