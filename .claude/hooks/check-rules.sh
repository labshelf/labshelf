#!/usr/bin/env bash
# PostToolUse hook for Edit/Write: reports AGENTS.md rule violations the edit introduces —
# size/shape, history language, ts-ignore/eslint-disable/skip/empty-catch, deleted tests, bad CONTRACT anchors, new files without a capability header.
set -u
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
file=$(jq -r '.tool_input.file_path // empty')
problems=()

finish() {
  [ ${#problems[@]} -eq 0 ] && exit 0
  printf '%s\n' "${problems[@]}" >&2
  exit 2
}

# Deleted test file: repo-wide, runs on every invocation regardless of which file triggered it.
while IFS= read -r line; do
  case "$line" in
    "D "*|" D"*)
      path="${line:3}"
      problems+=("$path was deleted. Tests of deleted code are deleted together with the code, not left as a stray diff — confirm this is intended (AGENTS.md §3, §4).")
      ;;
  esac
done < <(git -C "$root" status --porcelain -- 'packages/*/__tests__/*.ts' 2>/dev/null)

[ -n "$file" ] && [ -f "$file" ] || finish
case "$file" in "$root"/*) rel="${file#"$root"/}" ;; *) finish ;; esac

in_head() { git -C "$root" cat-file -e "HEAD:$rel" 2>/dev/null; }
head_text() { git -C "$root" show "HEAD:$rel" 2>/dev/null; }

# File and directory size.
limit=0
case "$rel" in
  packages/*/__tests__/*.ts) limit=500 ;;
  packages/*/src/*.ts|packages/*/src/*.tsx|packages/*/src/*.css|packages/*/build/*.mjs) limit=300 ;;
esac
if [ "$limit" -gt 0 ]; then
  lines=$(wc -l < "$file" | tr -d ' ')
  before=$(head_text | wc -l | tr -d ' ')
  if [ "$lines" -gt "$limit" ] && { ! in_head || [ "$lines" -gt "$before" ]; }; then
    problems+=("$rel has $lines lines (limit $limit). Split it by responsibility (AGENTS.md §3).")
  fi
  case "$rel" in packages/*/src/*)
    if ! in_head; then
      dir=$(dirname "$file")
      count=$(find "$dir" -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) ! -name 'index.ts' ! -name '*.d.ts' | wc -l | tr -d ' ')
      [ "$count" -gt 8 ] && problems+=("$(dirname "$rel") now holds $count source files (limit 8). Group them into subfolders by responsibility (AGENTS.md §3).")
    fi ;;
  esac
fi

# History language and dependency lists.
pattern='no longer|previously|used to|legacy|formerly|was replaced|were replaced|backward[- ]compat|deprecated|@depends|@dependents|@usedBy'
scope=""
case "$rel" in
  documents/plans/*|documents/archive/*) ;;
  documents/*.md|README.md) scope=doc ;;
  packages/*/src/*.ts|packages/*/src/*.tsx|packages/*/src/*.css|packages/*/__tests__/*.ts) scope=code ;;
esac
if [ -n "$scope" ]; then
  matches() {
    # "legacy build" is the name of a pdf.js distribution, not history.
    if [ "$scope" = code ]; then grep -E '^[[:space:]]*(//|/?\*)'; else cat; fi | grep -viE 'legacy[/ ]build' | grep -icE "$pattern"
  }
  now=$(matches < "$file"); was=$(head_text | matches)
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    hits=$(grep -inE "$pattern" "$file" | grep -viE 'legacy[/ ]build' | head -5)
    problems+=("$rel gained history language or dependency lists. Describe what is, without history, and drop @depends/@usedBy (AGENTS.md §3, §5):
$hits")
  fi
fi

# ts-ignore/ts-expect-error with no reason, eslint-disable, test-skip, empty catch.
code_scope=false
case "$rel" in
  packages/*/src/*.ts|packages/*/src/*.tsx|packages/*/src/*.css|packages/*/__tests__/*.ts) code_scope=true ;;
esac
if [ "$code_scope" = true ]; then
  ts_pattern='@ts-(ignore|expect-error)[[:space:]]*([*][/])?[[:space:]]*$'
  now=$(grep -cE "$ts_pattern" "$file"); was=$(head_text | grep -cE "$ts_pattern")
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    problems+=("$rel adds a @ts-ignore or @ts-expect-error with no reason. Add a reason after it, or fix the type error (AGENTS.md §5).")
  fi

  eslint_pattern='eslint-disable(-next-line|-line)?'
  now=$(grep -cE "$eslint_pattern" "$file"); was=$(head_text | grep -cE "$eslint_pattern")
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    problems+=("$rel adds an eslint-disable comment. Fix the lint issue instead of suppressing it (AGENTS.md §3).")
  fi

  skip_pattern='\.skip\(|xit\('
  now=$(grep -cE "$skip_pattern" "$file"); was=$(head_text | grep -cE "$skip_pattern")
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    problems+=("$rel skips a test (.skip( or xit(). Fix or delete the test, do not leave it skipped (AGENTS.md §6).")
  fi

  catch_pattern='catch\s*\([^\)]*\)\s*\{\s*\}'
  now=$(perl -0777 -ne "print scalar(() = /$catch_pattern/gs)" "$file")
  was=$(head_text | perl -0777 -ne "print scalar(() = /$catch_pattern/gs)")
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    problems+=("$rel adds an empty catch block. Log or surface the error, never swallow it silently (AGENTS.md §6).")
  fi
fi

# New source file: a header comment whose first sentence starts with a third-person verb.
case "$rel" in
  packages/*/src/*.ts|packages/*/src/*.tsx|packages/*/src/*.css|packages/*/build/*.mjs)
    if ! in_head; then
      first_line=$(grep -m1 -vE '^[[:space:]]*$' "$file")
      if ! printf '%s' "$first_line" | grep -qE '^[[:space:]]*(//|/\*)'; then
        problems+=("$rel: new source file has no header comment (AGENTS.md §3/§5).")
      else
        # The sentence may start on the line after a bare `/**`.
        first_word=$(grep -vE '^[[:space:]]*(/\*\*?|\*)?[[:space:]]*$' "$file" | head -1 \
          | sed -E 's#^[[:space:]]*(//|/\*\*?|\*)[[:space:]]*##' | awk '{print $1}')
        # TRAP: a plural noun ("Handlers", "Settings") also ends in s, so known ones are listed.
        if ! printf '%s' "$first_word" | grep -qE '^[A-Z][a-z]+(-[a-z]+)?[^s]s,?$' \
          || printf '%s' "$first_word" | grep -qxE 'Handlers|Settings|Types|Thumbnails|Annotations|Collections|Stylesheets|Extractors|Helpers|Utils'; then
          problems+=("$rel: header line 1 must be a capability sentence starting with a verb, e.g. \"// Searches papers by title.\" (AGENTS.md §5).")
        fi
      fi
    fi
    ;;
esac

# CONTRACT anchors must match a real heading in the referenced contract doc.
added_lines() {
  if in_head; then
    diff <(head_text) "$file" 2>/dev/null | grep '^> ' | sed 's/^> //'
  else
    cat "$file"
  fi
}
slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9 -]//g' | sed -E 's/[[:space:]]+/-/g' | sed -E 's/^-+//; s/-+$//'
}
contract_hits=$(added_lines | grep -oE 'CONTRACT: documents/contracts/[A-Za-z0-9_-]+\.md#[A-Za-z0-9-]+')
if [ -n "$contract_hits" ]; then
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    rest="${hit#CONTRACT: documents/contracts/}"
    docfile="${rest%%#*}"
    anchor="${rest#*#}"
    docpath="$root/documents/contracts/$docfile"
    if [ ! -f "$docpath" ]; then
      problems+=("$rel: CONTRACT references documents/contracts/$docfile which does not exist (AGENTS.md §5).")
      continue
    fi
    found=false
    while IFS= read -r heading; do
      [ -z "$heading" ] && continue
      if [ "$(slugify "$heading")" = "$anchor" ]; then
        found=true
        break
      fi
    done < <(grep -E '^#{1,6}[[:space:]]+' "$docpath" | sed -E 's/^#{1,6}[[:space:]]+//')
    if [ "$found" = false ]; then
      problems+=("$rel: CONTRACT anchor '#$anchor' not found in documents/contracts/$docfile (AGENTS.md §5).")
    fi
  done <<< "$contract_hits"
fi

finish
