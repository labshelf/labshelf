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
- Delegate by role: `explorer` (codebase questions, returns `brief/v1`), `implementer` (code changes, returns `report/v1`), `diagnoser` (after a `failed` report), `tester` (writes the hidden tests from a spec), `arbiter` (judges a `blocked_tests` report); `general-purpose` only for web research or work neither fits.
- Size the work first with `node scripts/plans/plan.mjs size <paths…>`: N0 main thread edits, N1 one implementer with an inline spec, N2 a one-session plan (`plan new --level N2`), N3 a multi-session plan approved by the user. The `orchestrate` skill has the flow.
- Run tests, typecheck and builds through `node scripts/agents/run.mjs test|typecheck|build <pkg>`; exit 3 `BLOCKED:` means stop and report. Check "does X exist?" with `node scripts/code/facts.mjs def|fn|sig|similar`, not an explorer.
- Docs: `node scripts/docs/doc.mjs` lists them; fetch sections, never whole files. Product: `node scripts/docs/doc.mjs product`; code placement: `node scripts/docs/doc.mjs code`; UI: `node scripts/docs/doc.mjs ui`.
RULES

branch=$(git branch --show-current 2>/dev/null)
status=$(git status --porcelain 2>/dev/null)
changed=$(printf '%s\n' "$status" | grep -c '^ \?[MADRC]')
untracked=$(printf '%s\n' "$status" | grep -c '^??')
areas=$(printf '%s\n' "$status" | awk '{print $NF}' | awk -F/ '$1=="packages"{print $1"/"$2; next} {print $1}' | sort | uniq -c | sort -rn | head -5 | awk '{printf "%s%s (%s)", sep, $2, $1; sep=", "}')

echo "LabShelf session context (from .claude/hooks/session-context.sh):"
echo "- Branch: ${branch:-detached} · uncommitted: ${changed} changed, ${untracked} untracked${areas:+ · most changes in: $areas}"

plans=$(node scripts/plans/plan.mjs status 2>/dev/null)
if [ -z "$plans" ]; then
  echo "- Active plans: none"
else
  echo "- Active plans (open/total checklist items in sessions/*.md):"
  echo "$plans"
fi

# Plans may run in sibling worktrees; list them so a session works where its plan lives.
worktrees=$(git worktree list 2>/dev/null | tail -n +2)
[ -n "$worktrees" ] && printf -- "- Other worktrees:\n%s\n" "$(echo "$worktrees" | sed 's/^/  /')"
exit 0
