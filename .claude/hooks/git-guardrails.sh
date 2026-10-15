#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks destructive git commands (push, reset --hard,
# clean -f, branch -D, checkout .) regardless of permission mode. The agent must
# ask the user to run the command themselves in their own terminal instead.
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cmd=$(jq -r '.tool_input.command // empty')
[ -n "$cmd" ] || exit 0

patterns=(
  'git[[:space:]]+push'
  'git[[:space:]]+reset[[:space:]]+--hard'
  'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*'
  'git[[:space:]]+branch[[:space:]]+-D'
  'git[[:space:]]+checkout[[:space:]]+(--[[:space:]]+)?\.([[:space:]]|$)'
)

segments=$(printf '%s\n' "$cmd" | sed -E 's/&&/\n/g; s/;/\n/g; s/\|/\n/g')
while IFS= read -r segment; do
  seg=$(printf '%s' "$segment" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
  [ -n "$seg" ] || continue
  for pattern in "${patterns[@]}"; do
    if printf '%s' "$seg" | grep -qE "$pattern"; then
      echo "Blocked by git-guardrails ($root): \"$seg\" is a destructive git command. Ask the user to run it themselves in their own terminal instead." >&2
      exit 2
    fi
  done
done <<< "$segments"

exit 0
