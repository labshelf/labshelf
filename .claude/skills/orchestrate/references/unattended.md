# Unattended runs

Read when the system prompt says the run is unattended (`scripts/plans/runPlan.mjs`). The runner adds one line per mode: unattended always, lint milestone and resume when they apply. Follow the sections it names.

## Unattended

You are running unattended from `scripts/plans/runPlan.mjs`: nobody reads this conversation until it ends and nobody answers questions. The run has no AskUserQuestion; never ask the user. Apply the session's decisions, and where it is silent pick the option that keeps current behaviour and note it in the handoff. The approved plan authorises the session's commits.

If the session cannot finish:
- YAML session: set its `status: blocked` with a one-line `blocked_reason` (for `spec_ambiguous`, the arbiter's `question`), close out what is done, and stop; the runner records why and continues with the next session that does not depend on it.
- Legacy `.md` session: write the remainder as `sessions/<id>-<name>.md` as [handoff.md](handoff.md) says, commit what is done, and stop.

Never leave tracked changes uncommitted.

TRAP: this is `claude -p`, so ending your turn ends the process and the session never finishes. Launch every subagent with `run_in_background: false` so its report returns inside the same turn, never end a turn to wait for an agent, and do not stop until the session is closed (YAML: `plan close`; legacy: session file deleted and committed) or set blocked (YAML) or a remainder file is committed (legacy).

### Testing policy

This policy overrides every `pnpm gate`, lint, baseline and knip/jscpd step in the session and the gate step of the finish skill:
- Implementers never run `pnpm gate` or any lint. They check their work only with `node scripts/agents/run.mjs typecheck <pkg>` for each package they changed and `node scripts/agents/run.mjs test <pkg> -- <test files of the code they changed>` (in the YAML flow, their spec's `tests.command` and `commands`). Say so in every implementer brief or spec.
- The session runs one check before its commit, `pnpm gate --no-lint` (typecheck and tests of the touched packages), and passes `gate: --no-lint only, no lint, no baselines` to `finish session`.
- Skip `node scripts/lint/modules.mjs --update` and `pnpm jscpd:update-baseline`, unless this session is a lint milestone.

## Lint milestone

This session is a lint milestone (the runner says so, or the YAML session has `milestone: true`). Before its commit, after its own packages:
1. Run the full `pnpm gate`, then `node scripts/lint/modules.mjs --update`, `pnpm jscpd:update-baseline` and `pnpm lint`.
2. Fix what fails, including problems earlier sessions left (they skipped lint): split files over 400 lines by concept, fix module rule violations, merge new duplicates. Never grow a baseline to pass.
3. Commit the fixes and the smaller baselines with the session (YAML: through `plan close`), and say in the handoff what the milestone fixed.

## Resume

A previous run of this session stopped (usage limit, or it ended its turn early) before it committed. The uncommitted changes are that run's partial work:
- read `git status` and `git diff --stat`, then the session's progress: the session file's OK column and its `research/` files (legacy), or each package's report in `.git/labshelf-runs/<plan>/` and the `plan status` output (YAML);
- keep what is correct, do not redo finished packages, and continue from there.

The dirty tree is expected; do not stop because the repo differs from **Starts from** (or the specs' `sha`) in those changes.
