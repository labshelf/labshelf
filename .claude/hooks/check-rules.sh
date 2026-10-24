#!/usr/bin/env bash
# Reports the rule violations an Edit/Write introduces: size and shape, history language, banned words, suppressions,
# commented-out code, hard-coded CSS values, unmirrored or deleted tests, bad CONTRACT anchors and missing capability headers.
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
      problems+=("$path was deleted. Tests of deleted code are deleted together with the code, not left as a stray diff — confirm this is intended.")
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
    problems+=("$rel has $lines lines (limit $limit). Split it by responsibility.")
  fi
  case "$rel" in packages/*/src/*)
    if ! in_head; then
      dir=$(dirname "$file")
      count=$(find "$dir" -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) ! -name 'index.ts' ! -name '*.d.ts' | wc -l | tr -d ' ')
      [ "$count" -gt 8 ] && problems+=("$(dirname "$rel") now holds $count source files (limit 8). Group them into subfolders by responsibility.")
    fi ;;
  esac
fi

# Plan and session size.
case "$rel" in
  documents/plans/*/plan.md) chars_limit=12000; chars_hint="Split it: move detail into sessions/ or research/ (plan format: documents/plans/TEMPLATE/plan.md)." ;;
  documents/plans/*/sessions/*.md) chars_limit=6000; chars_hint="Split the session or move context into research/." ;;
  *) chars_limit=0 ;;
esac
if [ "$chars_limit" -gt 0 ]; then
  chars=$(wc -m < "$file" | tr -d ' ')
  [ "$chars" -gt "$chars_limit" ] && problems+=("$rel has $chars characters (limit $chars_limit). $chars_hint")
fi

# History language and dependency lists.
pattern='no longer|previously|used to|legacy|formerly|was replaced|were replaced|backward[- ]compat|deprecated|instead of the old|refactored to|changed from|now (uses|keeps|has|is|does|returns|reads|writes)|@depends|@dependents|@usedBy'
scope=""
case "$rel" in
  documents/plans/*) ;;
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
    problems+=("$rel gained history language or dependency lists. Describe what is, without history, and drop @depends/@usedBy:
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
    problems+=("$rel adds a @ts-ignore or @ts-expect-error with no reason. Add a reason after it, or fix the type error.")
  fi

  eslint_pattern='eslint-disable(-next-line|-line)?'
  now=$(grep -cE "$eslint_pattern" "$file"); was=$(head_text | grep -cE "$eslint_pattern")
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    problems+=("$rel adds an eslint-disable comment. Fix the lint issue instead of suppressing it.")
  fi

  skip_pattern='\.skip\(|xit\('
  now=$(grep -cE "$skip_pattern" "$file"); was=$(head_text | grep -cE "$skip_pattern")
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    problems+=("$rel skips a test (.skip( or xit(). Fix or delete the test, do not leave it skipped.")
  fi

  catch_pattern='catch\s*\([^\)]*\)\s*\{\s*\}'
  now=$(perl -0777 -ne "print scalar(() = /$catch_pattern/gs)" "$file")
  was=$(head_text | perl -0777 -ne "print scalar(() = /$catch_pattern/gs)")
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    problems+=("$rel adds an empty catch block. Log or surface the error, never swallow it silently.")
  fi
fi

# Banned file names, comment tags and emoji (scripts/check-banned-words.mjs).
if [ "$code_scope" = true ]; then
  banned=$(node "$(dirname "$0")/../../scripts/check-banned-words.mjs" "$file" 2>&1)
  [ -n "$banned" ] && problems+=("$banned")
fi

# Commented-out code in added lines; the existing count may stay.
if [ "$code_scope" = true ]; then
  code_comment='^[[:space:]]*//[[:space:]]*(const|let|var|return|import|export|await|if[[:space:]]*\(|for[[:space:]]*\(|[A-Za-z_$.]+\(.*\);[[:space:]]*$|\}[[:space:]]*$)'
  now=$(grep -cE "$code_comment" "$file"); was=$(head_text | grep -cE "$code_comment")
  if [ "${now:-0}" -gt "${was:-0}" ]; then
    problems+=("$rel adds commented-out code. Delete it; git keeps the history.")
  fi
fi

# Hard-coded colours, sizes and fonts in app CSS; values come from the core --ls-* tokens.
case "$rel" in
  packages/vscode/src/*.css|packages/browser/src/*.css|packages/terminal/src/*.css)
    literal='#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(|\b[0-9.]+(px|rem|em)\b|font-family:[^;]*[^)];'
    now=$(grep -oE "$literal" "$file" | wc -l | tr -d ' '); was=$(head_text | grep -oE "$literal" | wc -l | tr -d ' ')
    if [ "${now:-0}" -gt "${was:-0}" ]; then
      problems+=("$rel adds a hard-coded colour, size or font. Use a core --ls-* design token.")
    fi ;;
esac

# A new test file mirrors a source file: __tests__/a/b.test.ts tests src/a/b.ts.
case "$rel" in
  packages/*/__tests__/*.test.ts|packages/*/__tests__/*.test.tsx)
    if ! in_head; then
      pkg_dir="${rel%%/__tests__/*}"; base="${rel#*/__tests__/}"; base="${base%.test.ts*}"
      mirrored=false
      for candidate in "$base.ts" "$base.tsx" "$base.css" "$base/index.ts"; do
        [ -f "$root/$pkg_dir/src/$candidate" ] && mirrored=true
      done
      [ "$mirrored" = true ] || problems+=("$rel has no source file at $pkg_dir/src/$base.ts. Name the test after the file it tests.")
    fi ;;
esac

# New source file: a header comment whose first sentence starts with a third-person verb.
case "$rel" in
  packages/*/src/*.ts|packages/*/src/*.tsx|packages/*/src/*.css|packages/*/build/*.mjs)
    if ! in_head; then
      first_line=$(grep -m1 -vE '^[[:space:]]*$' "$file")
      if ! printf '%s' "$first_line" | grep -qE '^[[:space:]]*(//|/\*)'; then
        problems+=("$rel: new source file has no header comment.")
      else
        # The sentence may start on the line after a bare `/**`.
        first_word=$(grep -vE '^[[:space:]]*(/\*\*?|\*)?[[:space:]]*$' "$file" | head -1 \
          | sed -E 's#^[[:space:]]*(//|/\*\*?|\*)[[:space:]]*##' | awk '{print $1}')
        # TRAP: a plural noun ("Handlers", "Settings") also ends in s, so known ones are listed.
        if ! printf '%s' "$first_word" | grep -qE '^[A-Z][a-z]+(-[a-z]+)?[^s]s,?$' \
          || printf '%s' "$first_word" | grep -qxE 'Handlers|Settings|Types|Thumbnails|Annotations|Collections|Stylesheets|Extractors|Helpers|Utils'; then
          problems+=("$rel: header line 1 must be a capability sentence starting with a verb, e.g. \"// Searches papers by title.\".")
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
      problems+=("$rel: CONTRACT references documents/contracts/$docfile which does not exist.")
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
      problems+=("$rel: CONTRACT anchor '#$anchor' not found in documents/contracts/$docfile.")
    fi
  done <<< "$contract_hits"
fi

finish
