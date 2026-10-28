# The YAML flow the orchestrate skill describes (session 10)

Decided content for `.claude/skills/orchestrate/`. Commands are `node scripts/plans/plan.mjs <cmd>` (sessions 5–8) unless named otherwise.

## Routing by level (D10)

1. `plan size <paths…>` suggests N0–N3; the orchestrator confirms or overrides with one line of reason.
2. N0: main thread edits, runs `run.mjs`, done. N1: inline `spec/v1` in the implementer prompt (no plan file); tester and finisher only when `plan size` lists a risk path. N2: `plan new --level N2`, one session, an explorer per area, tester for logic, formats, sync or data loss, finisher once. N3: `plan new --level N3`, several sessions, stop for user approval before running.

## Planning flow (N2, N3)

1. One `explorer` per area returns `brief/v1`; save it to `documents/plans/<slug>/research/<area>.brief.yaml`.
2. `plan new <slug> --level N2|N3`; `plan from-brief <brief> --spec <id>` per package.
3. The orchestrator fills per spec: `goal`, `acceptance`, `seams`, `decided`, `level`, `runner.model`, `tests` (hidden path and `tests.command` through `run.mjs test … --spec <id> --plan <slug>`, or `{none: reason}`).
4. `tester` per spec with tests (prompt = the spec block only); then `plan red <session> <id>`; a rejected test goes back to the tester with the output.
5. `plan lint <dir>` must be silent. N3: set `status: draft` and ask for approval; N2: set `approved` and run.

## Run flow per YAML session

Per package, in `depends_on` order (parallel when independent):

1. `plan stale <session> <id>`: re-scout only the stale paths with an explorer, update the spec, set its `sha`.
2. `plan start <session> <id>`, then `plan prompt <session> <id>` → `Agent` `implementer` with `model: <runner.model>`.
3. Route the `report/v1` (saved by `check-handoff` in `.git/labshelf-runs/<plan>/<id>.report.yaml`):
   - `done` → next package.
   - `missing` → an explorer for exactly the listed needs → update the spec (`edit`/`read`/`callers`) → a new implementer.
   - `blocked_tests` → `arbiter` with the spec, the hidden test paths, the log path. `code_wrong` → new implementer on `opus` with the `hint` appended to the prompt; `test_wrong` → `tester` fixes the test with the `fix`, then `plan red` again (event `test_fixed`); `spec_ambiguous` → unattended: set the session `blocked` with the `question`; attended: ask the user.
   - `failed` → `diagnoser`, whose `diagnosis/v1` `spec` becomes the next spec.
4. After all packages: `finish session <file>` (finisher review), then `plan close <session>`; it commits. Never commit by hand in the YAML flow.

## Legacy `.md` sessions

Plans with `sessions/*.md` keep today's flow (the current SKILL.md text and `references/run-plan.md`), including commits after `finish session`. Keep that text as a section, not a separate skill.

## Unattended rules

The runner's `UNATTENDED`, `MILESTONE` and `RESUME` texts (`scripts/plans/runPlan.mjs`, around :67-101) move verbatim-in-meaning into `references/unattended.md`, adapted to YAML (blocked session instead of stopping, no AskUserQuestion). runPlan's appended prompt becomes one line per mode pointing to that file (one source, D13).
