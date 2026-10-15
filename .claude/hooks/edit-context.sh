#!/usr/bin/env bash
# PreToolUse hook for Edit/Write/MultiEdit: surfaces why-comment tags already in the
# target file and memory entries that name it, so the model sees them before editing.
# Never blocks: always exits 0, output is plain stdout context (same convention as
# session-context.sh).
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty')

[ -n "$file" ] || exit 0
case "$file" in
  "$root"/*) rel="${file#"$root"/}" ;;
  *) exit 0 ;;
esac

# Dedupe per file per session. No session_id means no safe key, so always print.
marker=""
if [ -n "$session_id" ]; then
  marker="/tmp/labshelf-edit-context-${session_id}.seen"
  if [ -f "$marker" ] && grep -qxF "$rel" "$marker"; then
    exit 0
  fi
fi

lines=()

# Why-comment tags already in the file (AGENTS.md §5). A brand-new file has nothing to show.
if [ -f "$file" ]; then
  while IFS= read -r tag_line; do
    [ -n "$tag_line" ] && lines+=("$tag_line")
  done < <(grep -E 'TRAP:|INVARIANT:|PLATFORM:|CONTRACT:' "$file" 2>/dev/null)
fi

# Memory entries naming this file's path or its containing directory.
slug=$(printf '%s' "$root" | tr '/' '-')
mem_dir="$HOME/.claude/projects/$slug/memory"
mem_md="$mem_dir/MEMORY.md"
dir=$(dirname "$rel")

# A path is "named" when it appears as its own token, not merely as a prefix of a
# longer path to a different file (e.g. "packages/core/src" inside ".../src/other.ts").
path_mentioned() {
  local needle escaped
  needle="$1"
  escaped=$(printf '%s' "$needle" | sed -E 's/[.[\*^$()+?{}|\\]/\\&/g')
  grep -qE "(^|[^A-Za-z0-9_./-])${escaped}([^A-Za-z0-9_./-]|\$)" "$2" 2>/dev/null
}

if [ -f "$mem_md" ]; then
  mem_count=0
  while IFS= read -r entry_line; do
    [ "$mem_count" -ge 3 ] && break
    case "$entry_line" in
      "- ["*)
        title=$(printf '%s' "$entry_line" | sed -E 's/^- \[([^]]*)\].*/\1/')
        mdfile=$(printf '%s' "$entry_line" | sed -E 's/^- \[[^]]*\]\(([^)]*)\).*/\1/')
        [ -n "$mdfile" ] || continue
        memfile="$mem_dir/$mdfile"
        [ -f "$memfile" ] || continue
        if path_mentioned "$rel" "$memfile" || path_mentioned "$dir" "$memfile"; then
          lines+=("related memory: $title")
          mem_count=$((mem_count + 1))
        fi
        ;;
    esac
  done < "$mem_md"
fi

[ ${#lines[@]} -eq 0 ] && exit 0

echo "Context for $rel (.claude/hooks/edit-context.sh):"
printf '%s\n' "${lines[@]}" | head -9

if [ -n "$marker" ]; then
  printf '%s\n' "$rel" >> "$marker"
fi

exit 0
