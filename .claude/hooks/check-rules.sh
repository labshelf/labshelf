#!/usr/bin/env bash
# PostToolUse hook for Edit|Write|MultiEdit. Runs scripts/lint/sourceRules.mjs on the edited file and exits 2 with its problems on stderr.
# When a Write creates a product source file, adds a reminder to look at the sibling files first; the reminder never blocks.
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
repo_scripts="$(cd "$(dirname "$0")/../.." && pwd)/scripts/lint"
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty')
response_type=$(printf '%s' "$input" | jq -r '(.tool_response | objects | .type) // empty')

[ -n "$file" ] && [ -f "$file" ] || exit 0

problems=$(cd "$root" && node "$repo_scripts/sourceRules.mjs" "$file" 2>&1 >/dev/null)
status=$?

reminder=""
case "$file" in "$root"/*) rel="${file#"$root"/}" ;; *) rel="" ;; esac
case "$rel" in
  packages/*/src/*.ts|packages/*/src/*.tsx)
    is_new=false
    if [ "$tool" = Write ]; then
      if [ -n "$response_type" ]; then
        [ "$response_type" = create ] && is_new=true
      elif ! git -C "$root" cat-file -e "HEAD:$rel" 2>/dev/null; then
        is_new=true
      fi
    fi
    if [ "$is_new" = true ]; then
      list=""
      for sibling in "$(dirname "$file")"/*.ts "$(dirname "$file")"/*.tsx; do
        name=$(basename "$sibling")
        [ -f "$sibling" ] && [ "$sibling" != "$file" ] && [ "$name" != index.ts ] || continue
        case "$name" in *.d.ts) continue ;; esac
        count=$(wc -l < "$sibling" | tr -d ' ')
        header=$(grep -vE '^[[:space:]]*(/\*\*?|\*)?[[:space:]]*$' "$sibling" | head -1 \
          | sed -E 's#^[[:space:]]*(//|/\*\*?|\*)[[:space:]]*##; s#[[:space:]]*\*/[[:space:]]*$##')
        list="$list- $name ($count lines): $header
"
      done
      if [ -n "$list" ]; then
        reminder="Other files in $(dirname "$rel"):
${list}Before adding a file: does this code belong in one of these files of the same concept? A file under 80 lines used by a single file in its folder fails pnpm lint:modules."
      fi
    fi ;;
esac

if [ "$status" -ne 0 ] && [ -n "$problems" ]; then
  printf '%s\n' "$problems" >&2
  [ -n "$reminder" ] && printf '\n%s\n' "$reminder" >&2
  exit 2
fi

if [ -n "$reminder" ]; then
  jq -nc --arg context "$reminder" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $context}}'
fi
exit 0
