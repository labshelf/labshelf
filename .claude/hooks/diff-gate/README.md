# Diff gate

A Stop / SubagentStop hook (plus a PreToolUse `--pre-commit` autofix, see below) that stops an agent from finishing while its diff (committed, staged, unstaged and untracked changes since the session base, see below) introduces:

| Check | What it catches | Tool |
|---|---|---|
| `knip` | unused exports and enum members on added lines, new files nothing imports | `knip` with `scripts/lint/knip.json` (whole repo, only issues on added lines or new files are kept) |
| `jscpd` | copied code blocks that overlap added lines | `jscpd` with `scripts/lint/jscpd.json` (rewritten to a temp config with absolute paths) |
| `rules` | the repo's own source rules, including added lint suppressions | `scripts/lint/sourceRules.mjs --base HEAD` |
| `forbidden` | edits to `.claude/`, `scripts/lint/`, tsconfig, eslint, knip, jscpd and dependency-cruiser config, and to the `"scripts"` section of any `package.json` | git diff |

Problems that already exist at `HEAD` are never reported. A check that crashes or times out is dropped (reported under `errors` in the log and CLI); the other checks still run. Any internal error in hook mode ends in a silent exit 0.

## CLI

```sh
node diff-gate.mjs --repo <dir> --base <rev> [--head <rev>] [--json]
```

Without `--head` it checks the working tree against `--base`. With `--head` it compares two commits, using a throwaway `git clone --shared` checkout with `node_modules` re-linked (used to replay history). Exit 0 clean, 1 violations, 2 bad input.

## Policies, autofix, session base

Every violation is annotated (`annotation` in the JSON): unused export `{kind, localRefs, ...}` (declaration kind, references to the symbol inside its own file outside its own declaration), unused file `{configRefs, configFiles}` (build configs, manifests, html and scripts naming the file), source rule `{ruleClass}` (`eslint-disable | ts-ignore | test-skip | commented-code | other`). See `annotate.mjs`.

`DIFF_GATE_POLICY` (default `f`) maps annotated violations to `block | autofix | notify | silent` (`policy.mjs`, pure: `decide(violation, variant, ctx)` and `applyPolicy(violations, variant, ctx)` work on saved JSON; `ctx.subagent` is true on SubagentStop):

| Variant | Rule |
|---|---|
| `a` | everything blocks |
| `b` | as `a`, but unused file with `configRefs > 0` is silent |
| `c` | as `b`, plus unused export with `localRefs > 0` is autofixed (`localRefs == 0` blocks) |
| `d` | blocks only clone, source-rule `eslint-disable`/`ts-ignore`/`test-skip`, forbidden-path and forbidden-script; unused export with `localRefs > 0` is autofixed; everything else silent |
| `f` (default) | blocks clone and source-rule `eslint-disable`/`ts-ignore`/`test-skip`; forbidden-path and forbidden-script block only on SubagentStop (on the main thread's Stop they are notified); unused export with `localRefs > 0` is autofixed; everything else (unused export with `localRefs == 0`, unused file, other source rules) is notified |

Notify (variant `f` only): the hook prints `{"systemMessage": "..."}`, which Claude Code shows to the user and does not add to the model's context. The message is a heading plus at most 7 lines, `+N more` when cut. When the same run also blocks, the output holds both: `decision: "block"` with a `reason` listing the blocks only, and the `systemMessage` with the notifies. A notification never blocks, never counts towards `DIFF_GATE_MAX_BLOCKS`, and is shown once per session: the state file (`$TMPDIR/diff-gate-state-<session_id>.json`) keeps the keys (`kind|file|symbol`, so line shifts do not matter) already shown. An autofix that cannot be applied falls back to notify under `f` (to block under `a`-`d`).

Source-rule class `other` is silent in every variant except `a`. The CLI takes `--policy <v>` to add an `action` to each violation (silent ones then do not set the exit code).

Autofix (`autofix.mjs`): in hook mode, before deciding, the `export` keyword is removed from the flagged declaration line (`export function/async function/const/let/var/class/interface/type/enum`; never `export default`, export lists or multi-declarator lines). A pure text edit, nothing is re-run. If only autofixes happened the hook does not block; the log line has `"autofixed": ["file:line:symbol"]`. Under `a`-`d` an autofix that cannot be applied falls back to blocking.

Session base: `node diff-gate.mjs --session-start` (SessionStart hook; reads the JSON on stdin, writes `$TMPDIR/diff-gate-base-<session_id>.json`, prints nothing). It records the working tree: `git stash create` (a commit of the tracked changes, staged and unstaged, that leaves the tree untouched; HEAD when clean) as the base, and the content hashes of the untracked files. The Stop and pre-commit runs diff against that commit and leave out untracked files whose hash is unchanged, so work that was already there when the session started is not the session's. Order: `DIFF_GATE_BASE` env (skips no untracked file), then the record. **Without a record (session started before install, record gone or base unresolvable) the hook does nothing**: no block, no notify, no autofix (log line `decision: "no_session"`). `git add` in pre-commit stages a fixed file whole, pre-existing edits in it included.

## Pre-commit autofix

`node diff-gate.mjs --pre-commit` is a PreToolUse hook for the `Bash` tool. It reads the hook JSON (`tool_name`, `tool_input.command`, `cwd`, `session_id`); when the command has a `git commit` segment it runs the autofix part of the policy and stages the result, so the commit that follows contains the fix and the tree stays clean. Details:

- Detection (`commit-command.mjs`, pure): the command is split on `&&`, `||`, `;`, `|`, `&`, newlines and parentheses, quotes honoured (`echo "git commit"` does not match). Leading `VAR=x`, `git -C dir`, `git -c k=v` and `--no-pager` are skipped. `cd x && git commit` and `git -C x commit` fix the repo in `x`, not the session `cwd`.
- `git commit --amend` counts as a commit: the fix lands in the amended commit. `git commit <paths>` (commit only these paths) is not special-cased, so a fix in a file outside the paths stays staged but uncommitted.
- It uses the same session base and the same `DIFF_GATE_POLICY` as Stop, runs only `knip` (the only source of autofix actions, about 1 s), applies only the `autofix` actions (never notifies, never blocks, never denies) and runs `git add -- <files>` for exactly the files it edited. A file with unstaged edits of the agent is staged whole, so `git add a && git commit` can pull the other unstaged edits of a file whose export was fixed into that commit.
- Output is always empty and the exit code always 0 (no context added; any error is swallowed). With `DIFF_GATE_LOG` a line with `mode: "pre-commit"`, `autofixed` and `staged` is written when something was fixed or an error happened.
- The fixed keys are recorded in the session state (`autofixed`), so Stop never notifies about them.
- The Stop-time autofix stays as a fallback. A fix that lands at Stop after the last commit is left as an uncommitted one-line diff (a plan runner that stops on a dirty tree will stop); the pre-commit hook exists to avoid that, it cannot help when the session never runs `git commit` after writing the symbol.

## Hook

`node diff-gate.mjs --hook` reads the hook JSON on stdin (`cwd`, `session_id`, `stop_hook_active`, `hook_event_name`, `agent_type`) and prints `{"decision":"block","reason":"..."}` (reason at most 1500 characters), `{"systemMessage":"..."}`, both in one object, or nothing.

Environment: `DIFF_GATE_LOG=<file>` (default `.git/labshelf-logs/diff-gate.jsonl`) appends one JSONL line per run (event, agent, decision, violation counts, per-check ms, errors); `DIFF_GATE_CHECKS=forbidden,knip,jscpd,rules` limits the checks; `DIFF_GATE_MAX_BLOCKS=<n>` (default 3) sets how many consecutive blocks one session gets before the gate lets it through (a `stop_hook_active` run past the cap is logged as `allow_capped`); `DIFF_GATE_POLICY` (`a`-`d`, `f`) and `DIFF_GATE_BASE` are described above; `DIFF_GATE_TOOLS_ROOT` takes `node_modules/.bin` tools from another checkout; `DIFF_GATE_TOOL_TIMEOUT_MS` (default 90000).

`--settings` snippet:

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/diff-gate/diff-gate.mjs --session-start", "timeout": 10 }] }],
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/diff-gate/diff-gate.mjs --pre-commit", "timeout": 60 }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/diff-gate/diff-gate.mjs --hook", "timeout": 120 }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/hooks/diff-gate/diff-gate.mjs --hook", "timeout": 120 }] }]
  }
}
```

## Runtimes

Node (developed on 26.11), no npm dependencies. Needs `git` and the target repo's `node_modules` (`knip`, `jscpd`). Measured on a fresh APFS clone of labshelf: about 0.15 s for an empty diff, about 1.0 s for a 3-file diff (knip about 0.9 s, jscpd and rules about 0.17 s each, run in parallel).

## Tests

The hook tests written before `f` became the default run under `DIFF_GATE_POLICY=d` (set in `__tests__/helpers.mjs`); `__tests__/policy-f.test.mjs` covers `f`.

```sh
node scripts/agents/run.mjs test tooling -- .claude/hooks/diff-gate/__tests__/
```

These tests are not in the `test:tooling` globs: each of the 7 clone-based files copies the checkout (about 6 s each). They default to the repo root resolved from `helpers.mjs` (override with `DIFF_GATE_TEST_SOURCE`, `DIFF_GATE_TEST_TMP` picks the folder for clones) and commits it as the baseline with `--no-verify`.

## Blind spots

- The Stop-time autofix edits the working tree after the last commit, so it leaves a dirty tree (the removed `export` is uncommitted). `--pre-commit` avoids this when the session commits through Bash after writing the symbol; it does not help for commits made another way.
- A local reference is only counted outside string and comment text; `${...}` expressions inside single-line template literals count, multi-line template literals are not parsed.

- knip treats the core package's `package.json` exports and barrels as public API, so exports reachable from the core barrel are never flagged.
- Exports orphaned by deleting their last caller are not detected (the export line is not in the diff).
- The banned-words check is not a ratchet: only what `sourceRules` reports for the diff is seen.
- Observed with jscpd 5.4.1: clones are found only when the copy is a complete syntactic unit in a file that parses: a copied whole function (in a new or an existing file) is found; a few statements copied from the middle of a function into another function, or any file with a syntax error, are not.
- SubagentStop sees the whole working tree, so a subagent can be blocked for its parent's or a sibling's changes.
- It needs `node_modules` installed; without it knip and jscpd are skipped, not failed.
