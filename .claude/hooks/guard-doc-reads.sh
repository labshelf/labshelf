#!/usr/bin/env bash
# Denies whole-file Reads of documents/ outside plans/, so docs enter context one section at a time through scripts/doc.mjs.
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
partial=$(printf '%s' "$input" | jq -r 'if (.tool_input.offset // .tool_input.limit) then "yes" else "" end')
case "$file" in
  "$root"/documents/plans/*|"$root"/documents/ideas/*) exit 0 ;;
  "$root"/documents/*.md)
    [ -n "$partial" ] && exit 0
    doc="${file#"$root"/documents/}"; doc="${doc%.md}"
    jq -n --arg reason "Read one section instead: node scripts/doc.mjs $doc lists its headings, node scripts/doc.mjs $doc#<anchor> prints one. To edit, Read with offset and limit around the lines you change." \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
    ;;
esac
exit 0
