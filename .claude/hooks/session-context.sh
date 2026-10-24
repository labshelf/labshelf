#!/usr/bin/env bash
# SessionStart hook: prints the session rules and a few lines of repo state (branch, uncommitted work, active plans,
# other worktrees) so the model knows how to work and where things stand without reading files. Plain stdout becomes context.
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0

cat <<'RULES'
LabShelf is a local-first research paper manager shipped as a VS Code extension, a browser extension and a terminal app (packages core, vscode, browser, terminal).
- Talk to the user in the language they write in. Everything committed is in English.
- When you have a recommendation, apply it and report it. Ask only when there is no clear recommendation, or before a hard-to-reverse action.
- No ceremony the user did not ask for: no extra logs, gates, or `verify` runs.
- End replies with what was not checked.
- Docs: `node scripts/docs/doc.mjs` lists them; fetch sections, never whole files. Rules for code, UI and docs: `node scripts/docs/doc.mjs rules`.
RULES

branch=$(git branch --show-current 2>/dev/null)
status=$(git status --porcelain 2>/dev/null)
changed=$(printf '%s\n' "$status" | grep -c '^ \?[MADRC]')
untracked=$(printf '%s\n' "$status" | grep -c '^??')
areas=$(printf '%s\n' "$status" | awk '{print $NF}' | awk -F/ '$1=="packages"{print $1"/"$2; next} {print $1}' | sort | uniq -c | sort -rn | head -5 | awk '{printf "%s%s (%s)", sep, $2, $1; sep=", "}')

echo "LabShelf session context (from .claude/hooks/session-context.sh):"
echo "- Branch: ${branch:-detached} · uncommitted: ${changed} changed, ${untracked} untracked${areas:+ · most changes in: $areas}"

plans=$(find documents/plans -mindepth 2 -maxdepth 2 -name plan.md -not -path 'documents/plans/TEMPLATE/*' 2>/dev/null | sort)
if [ -z "$plans" ]; then
  echo "- Active plans: none"
else
  echo "- Active plans (open/total checklist items in sessions/*.md):"
  for p in $plans; do
    dir=$(dirname "$p")
    sessions=$(find "$dir/sessions" -name '*.md' 2>/dev/null | sort)
    open=0; total=0; next=""
    if [ -n "$sessions" ]; then
      # shellcheck disable=SC2086
      open=$(cat $sessions | grep -c '\[ \]'); total=$(cat $sessions | grep -ciE '\[( |x)\]')
      # The lowest-numbered session file that still has an unticked table row holds the next step.
      first=$(echo "$sessions" | while read -r f; do grep -qE '^\|.*\[ \][[:space:]]*\|?[[:space:]]*$' "$f" && { echo "$f"; break; }; done)
      [ -n "$first" ] && next=$(grep -m1 -E '^\|.*\[ \][[:space:]]*\|?[[:space:]]*$' "$first" | awk -F'|' '{gsub(/^ +| +$/, "", $2); gsub(/^ +| +$/, "", $3); print $2 " " $3}' | cut -c1-90)
    fi
    state=$(grep -m1 -E '^Status:' "$p" | sed 's/^Status: *//')
    echo "  - $dir: $open/$total open${state:+ · status: $state}${next:+ · next: $next}"
  done
fi

# Plans may run in sibling worktrees; list them so a session works where its plan lives.
worktrees=$(git worktree list 2>/dev/null | tail -n +2)
[ -n "$worktrees" ] && printf -- "- Other worktrees:\n%s\n" "$(echo "$worktrees" | sed 's/^/  /')"
exit 0
