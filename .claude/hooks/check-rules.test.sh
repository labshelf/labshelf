#!/usr/bin/env bash
# Fixture-driven test for check-rules.sh: builds a throwaway git repo per case,
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
  printf 'it("a", () => {});\n' > "$repo/packages/core/__tests__/gone.ts"
  printf '// Other file.\nexport const x = 1;\n' > "$repo/packages/core/src/other.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m init

  rm "$repo/packages/core/__tests__/gone.ts"
  printf '// Other file.\nexport const x = 2;\n' > "$repo/packages/core/src/other.ts"

  local out
  out=$(printf '{"tool_input":{"file_path":"%s"}}' "$repo/packages/core/src/other.ts" | CLAUDE_PROJECT_DIR="$repo" "$hook" 2>&1 >/dev/null)
  local code=$?
  rm -rf "$repo"

  if [ "$code" -eq 2 ] && printf '%s' "$out" | grep -qiE 'deleted'; then
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
  printf 'it("a", () => {});\n' > "$repo/packages/core/__tests__/old.ts"
  printf '// Other file.\nexport const x = 1;\n' > "$repo/packages/core/src/other.ts"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m init

  git -C "$repo" mv packages/core/__tests__/old.ts packages/core/__tests__/renamed.ts
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

run_case "new file with a noun-phrase header" \
  "packages/core/src/newfile.ts" \
  "" \
  "// PubMed client: record lookup by PMID.
export const x = 1;
" \
  2 "capability sentence"

run_case "new file with a plural-noun header" \
  "packages/core/src/newfile.ts" \
  "" \
  "// Handlers for the popup messages.
export const x = 1;
" \
  2 "capability sentence"

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

echo "----"
echo "$((total - fail))/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
