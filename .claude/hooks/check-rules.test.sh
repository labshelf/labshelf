#!/usr/bin/env bash
# Fixture-driven test for the check-rules.sh dispatcher and the rules it runs: builds a throwaway git repo per case,
# introduces one violation (or none) against a committed HEAD, and checks the hook's verdict.
set -u
hook="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-rules.sh"
fail=0
total=0
# Split so this script's own source never contains the literal tag the hook scans for.
contract_tag="CONTR""ACT"

# run_case <name> <rel-path> <head-content-var> <working-content-var> <expect-exit> <expect-grep>
run_case() {
  local name="$1" rel="$2" head_content="$3" work_content="$4" expect_exit="$5" expect_grep="$6"
  total=$((total + 1))

  local repo
  repo=$(mktemp -d)
  git -C "$repo" init -q
  git -C "$repo" config user.email test@test.com
  git -C "$repo" config user.name test

  mkdir -p "$repo/$(dirname "$rel")"
  mkdir -p "$repo/documents/contracts"

  if [ -n "$head_content" ]; then
    printf '%s' "$head_content" > "$repo/$rel"
    git -C "$repo" add -A
    git -C "$repo" commit -q -m init
  fi

  # Contract doc fixture, present for every case so anchor checks have something to read.
  printf '%s\n' '# Sync' '' '## Conflict resolution' '' 'Body text.' > "$repo/documents/contracts/sync.md"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "contract doc" --allow-empty -q 2>/dev/null || true

  printf '%s' "$work_content" > "$repo/$rel"

  local out
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$repo/$rel" | CLAUDE_PROJECT_DIR="$repo" "$hook" 2>&1 >/dev/null)
  local code=$?

  rm -rf "$repo"

  local ok=true
  [ "$code" -eq "$expect_exit" ] || ok=false
  if [ -n "$expect_grep" ]; then
    printf '%s' "$out" | grep -qiE "$expect_grep" || ok=false
  elif [ "$expect_exit" -eq 0 ]; then
    [ -z "$out" ] || ok=false
  fi

  if [ "$ok" = true ]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (exit=$code expected=$expect_exit, output follows)"
    echo "$out" | sed 's/^/    /'
    fail=$((fail + 1))
  fi
}

# 1. @ts-ignore / @ts-expect-error with no reason.
run_case "ts-ignore no reason" \
  "packages/core/src/sample.ts" \
  "// Sample.
export const x = 1;
" \
  "// Sample.
// @ts-ignore
export const x: number = '1';
" \
  2 "ts-ignore|ts-expect-error"

run_case "ts-expect-error WITH reason is not flagged" \
  "packages/core/src/sample.ts" \
  "// Sample.
export const x = 1;
" \
  "// Sample.
// @ts-expect-error: narrowing is intentional here
export const x: number = '1';
" \
  0 ""

# 2. eslint-disable.
run_case "eslint-disable added" \
  "packages/core/src/sample.ts" \
  "// Sample.
export const x = 1;
" \
  "// Sample.
// eslint-disable-next-line
export const x = 1;
" \
  2 "eslint-disable"

# 3. .skip( / xit(.
run_case "test skip added" \
  "packages/core/__tests__/sample.ts" \
  "// Sample test.
it('works', () => {});
" \
  "// Sample test.
it.skip('works', () => {});
" \
  2 "skip"

# 4. empty catch block.
run_case "empty catch added" \
  "packages/core/src/sample.ts" \
  "// Sample.
export function f() {
  try { g(); } catch (e) { report(e); }
}
" \
  "// Sample.
export function f() {
  try {
    g();
  } catch (e) {
  }
}
" \
  2 "catch"

# 5. deleted test file (repo-wide, independent of the edited file).
run_case_deleted_test() {
  total=$((total + 1))
  local repo
  repo=$(mktemp -d)
  git -C "$repo" init -q
  git -C "$repo" config user.email test@test.com
  git -C "$repo" config user.name test
  mkdir -p "$repo/packages/core/__tests__" "$repo/packages/core/src" "$repo/documents/contracts"
  printf '%s\n' '# Sync' '' '## Conflict resolution' > "$repo/documents/contracts/sync.md"
  printf 'it("a", () => {});\n' > "$repo/packages/core/__tests__/gone.test.ts"
  printf '// Gone.\nexport const g = 1;\n' > "$repo/packages/core/src/gone.ts"
  printf '// Other file.\nexport const x = 1;\n' > "$repo/packages/core/src/other.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m init

  rm "$repo/packages/core/__tests__/gone.test.ts"
  printf '// Other file.\nexport const x = 2;\n' > "$repo/packages/core/src/other.ts"

  local out
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$repo/packages/core/src/other.ts" | CLAUDE_PROJECT_DIR="$repo" "$hook" 2>&1 >/dev/null)
  local code=$?
  rm -rf "$repo"

  if [ "$code" -eq 2 ] && printf '%s' "$out" | grep -qiE 'its code still exists'; then
    echo "PASS: deleted test file flagged"
  else
    echo "FAIL: deleted test file flagged (exit=$code, output follows)"
    echo "$out" | sed 's/^/    /'
    fail=$((fail + 1))
  fi
}
run_case_deleted_test

# Renamed test file must NOT be flagged as a deletion.
run_case_renamed_test() {
  total=$((total + 1))
  local repo
  repo=$(mktemp -d)
  git -C "$repo" init -q
  git -C "$repo" config user.email test@test.com
  git -C "$repo" config user.name test
  mkdir -p "$repo/packages/core/__tests__" "$repo/packages/core/src" "$repo/documents/contracts"
  printf '%s\n' '# Sync' '' '## Conflict resolution' > "$repo/documents/contracts/sync.md"
  printf 'it("a", () => {});\n' > "$repo/packages/core/__tests__/old.test.ts"
  printf '// Old.\nexport const o = 1;\n' > "$repo/packages/core/src/old.ts"
  printf '// Other file.\nexport const x = 1;\n' > "$repo/packages/core/src/other.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m init

  git -C "$repo" mv packages/core/__tests__/old.test.ts packages/core/__tests__/renamed.test.ts
  printf '// Other file.\nexport const x = 2;\n' > "$repo/packages/core/src/other.ts"

  local out
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$repo/packages/core/src/other.ts" | CLAUDE_PROJECT_DIR="$repo" "$hook" 2>&1 >/dev/null)
  local code=$?
  rm -rf "$repo"

  if [ "$code" -eq 0 ] && [ -z "$out" ]; then
    echo "PASS: renamed test file not flagged"
  else
    echo "FAIL: renamed test file not flagged (exit=$code, output follows)"
    echo "$out" | sed 's/^/    /'
    fail=$((fail + 1))
  fi
}
run_case_renamed_test

# 6. CONTRACT with missing anchor.
run_case "CONTRACT anchor missing" \
  "packages/core/src/sample.ts" \
  "// Sample.
export const x = 1;
" \
  "// Sample.
// ${contract_tag}: documents/contracts/sync.md#no-such-anchor
export const x = 1;
" \
  2 "anchor"

run_case "CONTRACT anchor matching a heading is not flagged" \
  "packages/core/src/sample.ts" \
  "// Sample.
export const x = 1;
" \
  "// Sample.
// ${contract_tag}: documents/contracts/sync.md#conflict-resolution
export const x = 1;
" \
  0 ""

# 7. new source file with no header comment.
run_case "new file with no header" \
  "packages/core/src/newfile.ts" \
  "" \
  "export const x = 1;
" \
  2 "header"

run_case "new file WITH header is not flagged" \
  "packages/core/src/newfile.ts" \
  "" \
  "// Does a thing.
export const x = 1;
" \
  0 ""

run_case "new file with a noun-phrase header is not flagged" \
  "packages/core/src/newfile.ts" \
  "" \
  "// PubMed client: record lookup by PMID.
export const x = 1;
" \
  0 ""

run_case "new CSS file with a capability header is not flagged" \
  "packages/core/src/newfile.css" \
  "" \
  "/* Styles the library list rows. */
.row { display: flex; }
" \
  0 ""

run_case "new file with a JSDoc capability header is not flagged" \
  "packages/core/src/newfile.ts" \
  "" \
  "/**
 * Parses BibTeX entries into paper records.
 */
export const x = 1;
" \
  0 ""

# 8. plan and session size caps (characters, not lines).
chars() { head -c "$1" /dev/zero | tr '\0' 'a'; }
plan_over="# Plan
$(chars 12001)"
plan_under="# Plan
$(chars 11000)"
session_over="# Session
$(chars 6001)"
session_under="# Session
$(chars 5000)"

run_case "plan.md over 12000 characters warns" \
  "documents/plans/some-slug/plan.md" "" "$plan_over" \
  2 "characters \(limit"

run_case "plan.md under the cap is silent" \
  "documents/plans/some-slug/plan.md" "" "$plan_under" \
  0 ""

run_case "session file over 6000 characters warns" \
  "documents/plans/some-slug/sessions/01-first.md" "" "$session_over" \
  2 "characters \(limit"

run_case "session file under the cap is silent" \
  "documents/plans/some-slug/sessions/01-first.md" "" "$session_under" \
  0 ""

run_case "plan log.md over 12000 characters is silent" \
  "documents/plans/some-slug/log.md" "" "$plan_over" \
  0 ""

# Baseline: a clean diff reports nothing.
run_case "clean diff" \
  "packages/core/src/sample.ts" \
  "// Sample.
export const x = 1;
" \
  "// Sample.
export const x = 2;
" \
  0 ""

# Banned words come from scripts/lint/bannedWords.mjs.
run_case "TODO tag added" \
  "packages/core/src/sample.ts" \
  "// Sample.
export const x = 1;
" \
  "// Sample.
// TODO: make it 2
export const x = 1;
" \
  2 "TODO tag"

run_case "commented-out code added" \
  "packages/core/src/sample.ts" \
  "// Sample.
export const x = 1;
" \
  "// Sample.
// const y = 2;
export const x = 1;
" \
  2 "commented-out"

run_case "hard-coded colour in app CSS" \
  "packages/browser/src/popup/popup.css" \
  "/* Styles the popup. */
.a { color: var(--ls-fg); }
" \
  "/* Styles the popup. */
.a { color: #ff0000; }
" \
  2 "design token"

run_case "core CSS may define token values" \
  "packages/core/src/ui/tokens.css" \
  "/* Defines the tokens. */
:root { --ls-fg: #000; }
" \
  "/* Defines the tokens. */
:root { --ls-fg: #111; --ls-bg: #fff; }
" \
  0 ""

run_case "new test file without a mirrored source" \
  "packages/core/__tests__/library/missing.test.ts" \
  "" \
  "// Tests nothing real.
it('a', () => {});
" \
  2 "no source file"

# Cases that seed extra files and read both streams: run_repo_case <name> <tool> <response-json> <rel> <content> <expect-exit> <stderr-grep> <stdout-grep>
# Seeded files: src/lib/thing/a.ts (folder), src/lib/sib.ts (60 lines, header "Reads siblings.").
run_repo_case() {
  local name="$1" tool="$2" response="$3" rel="$4" content="$5" expect_exit="$6" err_grep="$7" out_grep="$8"
  total=$((total + 1))
  local repo
  repo=$(mktemp -d)
  git -C "$repo" init -q
  git -C "$repo" config user.email test@test.com
  git -C "$repo" config user.name test
  mkdir -p "$repo/packages/core/src/lib/thing" "$repo/documents/contracts"
  printf '// Folder member.\nexport const a = 1;\n' > "$repo/packages/core/src/lib/thing/a.ts"
  { printf '/** Reads siblings. */\n'; for i in $(seq 1 59); do printf 'export const v%s = %s;\n' "$i" "$i"; done; } > "$repo/packages/core/src/lib/sib.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m init
  mkdir -p "$repo/$(dirname "$rel")"
  printf '%s' "$content" > "$repo/$rel"

  local stdout stderr code
  stdout=$(mktemp); stderr=$(mktemp)
  printf '{"tool_name":"%s","tool_input":{"file_path":"%s"},"tool_response":%s}' "$tool" "$repo/$rel" "$response" \
    | CLAUDE_PROJECT_DIR="$repo" "$hook" >"$stdout" 2>"$stderr"
  code=$?
  local out err
  out=$(cat "$stdout"); err=$(cat "$stderr")
  rm -rf "$repo" "$stdout" "$stderr"

  local ok=true
  [ "$code" -eq "$expect_exit" ] || ok=false
  if [ -n "$err_grep" ]; then printf '%s' "$err" | grep -qE "$err_grep" || ok=false; elif [ "$expect_exit" -eq 0 ] && [ -n "$err" ]; then ok=false; fi
  if [ -n "$out_grep" ]; then printf '%s' "$out" | grep -qE "$out_grep" || ok=false; elif [ -n "$out" ]; then ok=false; fi
  if [ "$ok" = true ]; then
    echo "PASS: $name"
  else
    echo "FAIL: $name (exit=$code expected=$expect_exit)"
    echo "    stdout: $out"; echo "    stderr: $err" | head -8
    fail=$((fail + 1))
  fi
}

run_repo_case "test may mirror a whole source folder" Write '{"type":"create"}' \
  "packages/core/__tests__/lib/thing.test.ts" "// Tests the thing folder.
it('a', () => {});
" \
  0 "" ""

run_repo_case "new Write of a source file adds the sibling reminder as JSON" Write '{"type":"create"}' \
  "packages/core/src/lib/fresh.ts" "// Holds fresh code.
export const f = 1;
" \
  0 "" '"hookEventName":"PostToolUse".*sib\.ts \(60 lines\): Reads siblings\..*Before adding a file'

run_repo_case "reminder falls back to HEAD when the response has no type" Write '"ok"' \
  "packages/core/src/lib/fresh.ts" "// Holds fresh code.
export const f = 1;
" \
  0 "" 'additionalContext'

run_repo_case "overwriting an existing file adds no reminder" Write '{"type":"update"}' \
  "packages/core/src/lib/sib.ts" "// Reads siblings.
export const v = 1;
" \
  0 "" ""

run_repo_case "an Edit adds no reminder" Edit '{}' \
  "packages/core/src/lib/sib.ts" "// Reads siblings.
export const v = 2;
" \
  0 "" ""

run_repo_case "reminder is appended to the problems when the file also fails" Write '{"type":"create"}' \
  "packages/core/src/lib/fresh.ts" "export const f = 1;
" \
  2 "sib\.ts \(60 lines\)" ""

echo "----"
echo "$((total - fail))/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
