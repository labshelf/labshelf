# Plan: Agent pipeline

Status: approved
Size: 10 sessions — each layer (filter, schemas, guard, scaffolding, close, runner, index, skill) is usable on its own and must land before the next one builds on it.

## 1. Goal

Rebuild the Claude Code tooling so models spend tokens only on judgment and scripts do the rest. Work is sized in levels N0–N3. Agents hand off through fixed YAML schemas checked by hooks. Implementers run inside a spec they cannot leave and against tests written at plan time that they cannot see. Commits are per package and deterministic. A local index answers code lookups. Every step reports to agent-telemetry. Plans run overnight without the user.

## 2. Decisions

- [ ] **D1** Bootstrapping: this plan runs on today's flow (`.md` session files, current `orchestrate` skill, `scripts/plans/runPlan.mjs`). Every change keeps `.md` plans working; the new YAML flow becomes the default only in session 10, and the `.md` path stays for plans already in progress (qmd-notes and others). — the plan rebuilds the machinery that executes it.
- [ ] **D2** New hooks act only when their input opts in: `spec-guard` only when the implementer's prompt holds a `spec/v1` block, `check-handoff` only when the agent type has a schema. Without the block, behaviour is unchanged. — later sessions of this plan and older plans keep running.
- [ ] **D3** Handoff format: one fenced block ```` ```yaml <kind>/v1 ```` per message; kinds `plan`, `session`, `spec`, `report`, `brief`, `diagnosis`, `verdict`. Fields in [research/schemas.md](research/schemas.md). Validators are hand-written in `scripts/agents/schemas.mjs` (no zod); YAML through the `yaml` package added to the root devDependencies.
- [ ] **D4** Noise is cut by a wrapper, not by rewriting tool output: `node scripts/agents/run.mjs <test|typecheck|build|cmd> …` keeps the full log in `.git/labshelf-logs/` and prints a compact summary with the original exit code. A PreToolUse hook denies raw `jest`, `tsc`, `node --test`, `pnpm test`, `pnpm test:tooling` and `pnpm --filter … test|typecheck|build` and names the wrapper command. `pnpm gate` stays allowed (already compact). — `updatedInput` and `updatedToolOutput` on built-in Bash are not confirmed by the docs; `deny` with a reason is.
- [ ] **D5** Test attempts are counted by `run.mjs test --spec <id>` in `.git/labshelf-runs/<plan>/<id>.json`: two consecutive runs whose failing set does not shrink, or five runs in total, make the wrapper refuse further runs and print `BLOCKED`. `check-handoff` accepts `status: done` only if the last recorded run is green.
- [ ] **D6** Tests written at plan time live in `documents/plans/<slug>/tests/<spec-id>/` mirroring the package path, never in `packages/` until `plan start <spec>` copies them in. `spec-guard` hides them from the implementer (no Read, Edit, Write, Bash). The implementer writes no tests. Test files change only through `tester` after an `arbiter` verdict `test_wrong`, or through a codemod (moves, renames).
- [ ] **D7** `plan red` writes the stubs from the spec's `seams` and the hidden tests into the working tree, runs the test command, then restores every touched file (record in `.git/labshelf-red.json`, `plan red --restore` after a crash): every test must fail with `not implemented`; a compile or import error rejects the test. A temporary worktree would need its own `pnpm install`. Nothing red is ever committed, so the gate stays green between sessions.
- [ ] **D8** Commits: after the session's `finisher` review, `plan close` runs `pnpm gate --no-lint` once (full gate on milestones), then makes one commit per package with only that spec's `edit`, `create` and test paths; the message comes from the spec (`<goal>`, body `Package <id> of plan <slug>`, attribution trailer). Changed files in the session Owns but in no spec go into one last commit `Session <id> review fixes`; changed files outside Owns fail the close.
- [ ] **D9** Agents follow the `-er` naming: `explorer`, `implementer`, `finisher`, `diagnoser` (renamed from `diagnose`), `tester` (writes tests at plan time from the spec only), `arbiter` (judges `blocked_tests`: `code_wrong` | `test_wrong` | `spec_ambiguous`).
- [ ] **D10** Levels: N0 main thread only; N1 inline spec, one implementer, test and review only on risk paths; N2 one session, explorer per area, tester on logic/format/sync/data, finisher once; N3 multi-session plan, approval stop. `plan size` suggests the level from files, packages, callers and risk paths; the orchestrator confirms.
- [ ] **D11** Telemetry: every script and hook calls `emit(kind, fields)` from `scripts/agents/telemetry.mjs`, which appends one JSON line to `$LABSHELF_TELEMETRY_SPOOL` (default `~/Developer/pessoal/agent-telemetry/data/plan-events/<day>.jsonl`) and never throws. agent-telemetry gets a `plan_events` table, a loader and a report section. The runner exports `LABSHELF_PLAN_RUN_ID` and logs it with the Claude `session_id` from the stream-json init event, so costs join exactly.
- [ ] **D12** Index: `scripts/ctx/` with `node:sqlite` + FTS5 in `.git/labshelf-ctx.db`. Structural part from `oxc-parser` + `oxc-resolver` (imports, exports, top-level declarations, call sites); embeddings from ollama `nomic-embed-text`, skipped when ollama is down. Updated by file hash: a PostToolUse Edit|Write hook reindexes the file; the runner runs `ctx build` (incremental) before each session. Answers are capped at about 8k tokens.
- [ ] **D13** Unattended runs: the runner adds `--permission-prompts none` (no AskUserQuestion), keeps `--permission-mode auto`, supports YAML sessions with `depends_on`, and on a session that ends `blocked` records why and continues with the next session that does not depend on it. The rules now in its `UNATTENDED` prompt move into the orchestrate skill (one source).

Open (blocks approval): none. Defaults applied: agent names `tester`/`arbiter`; tests outside `packages/` until start; wrapper over output rewriting; `.md` plans kept.

## 3. Acceptance

- [ ] **A1** An implementer with a `spec/v1` block cannot Read, Edit or Write a path outside the spec, cannot touch a hidden test, and gets a deny that says to report `missing`; without a spec block nothing changes (hook tests).
- [ ] **A2** A subagent whose final message has an invalid or missing YAML block for its type is sent back once with the errors; an implementer reporting `done` without a green last run is sent back (hook tests).
- [ ] **A3** `run.mjs test` and `run.mjs typecheck` print at most 40 lines for a failing jest or tsc run, keep the exit code and save the full log; a raw `pnpm --filter @labshelf/core test` is denied with the wrapper command in the reason.
- [ ] **A4** After two non-improving runs or five runs, `run.mjs test --spec <id>` prints `BLOCKED` and exits 3.
- [ ] **A5** `plan new`, `plan lint`, `plan from-brief`, `plan prompt`, `plan stale` work on a fixture plan; `plan lint` is silent on success and fails on overlapping `edit` paths in parallel packages and on an acceptance id without a test.
- [ ] **A6** `plan red` accepts tests that fail with `not implemented` against stubs and rejects a test with an import error; the working tree is unchanged afterwards.
- [ ] **A7** `plan close` on a fixture repo makes one commit per package with only its spec paths and the spec-derived message, and fails when a changed file is outside Owns.
- [ ] **A8** `runPlan.mjs --dry-run` orders a fixture YAML plan by `depends_on`, skips a session that depends on a blocked one, and still runs a legacy `.md` plan.
- [ ] **A9** A fixture spool loads into `plan_events`, and the agent-telemetry report has a pipeline section with package status counts, test runs, verdicts, index queries and cost per level.
- [ ] **A10** `ctx def <symbol>` and `ctx refs <symbol>` return the right paths and lines on a fixture (including a `.js` → `.ts` import and a re-export through `index.ts`); editing a file updates its rows; `ctx q` returns at most the cap and works without ollama (text only).
- [ ] **A11** `.claude/agents/` has `diagnoser.md`, `tester.md`, `arbiter.md` and no `diagnose.md`; `rg --hidden -w diagnose .claude scripts documents` finds no agent reference.
- [ ] **A12** The orchestrate skill routes N0–N3 and runs a YAML session end to end on a fixture plan in a dry run (spec → implementer prompt → report → close).

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1.md](sessions/1.md) | dependencies, hook probes, telemetry emitter and ETL, diagnoser rename | root `package.json`, lockfile, `scripts/agents/telemetry.mjs`, agent-telemetry (outside git) | alone |
| 2 | [sessions/2.md](sessions/2.md) | output wrapper, Bash guard, per-agent budgets | `scripts/agents/run.mjs`, hooks, `.claude/settings.json`, agent and skill texts with raw commands | alone |
| 3 | [sessions/3.md](sessions/3.md) | schemas, agent definitions, handoff check | `scripts/agents/schemas.mjs`, `.claude/agents/`, `check-handoff.mjs`, settings | alone |
| 4 | [sessions/4.md](sessions/4.md) | spec guard | `spec-guard.mjs`, settings | alone |
| 5 | [sessions/5.md](sessions/5.md) | plan new, lint, from-brief, prompt, stale (generated, no template files) | `scripts/plans/` | alone |
| 6 | [sessions/6.md](sessions/6.md) | stubs, test skeletons, red, start, close | `scripts/plans/`, parser exports in `run.mjs` | alone |
| 7 | [sessions/7.md](sessions/7.md) | runner for YAML plans, plan status, session context | `runPlan.mjs`, `planQueue.mjs`, `planStatus.mjs`, `session-context.sh` | alone |
| 8 | [sessions/8.md](sessions/8.md) | structural index, reindex hook, plan size | `scripts/ctx/`, `ctx-reindex.mjs`, settings, `planSize.mjs` | alone |
| 9 | [sessions/9.md](sessions/9.md) | embeddings, hybrid query, local log fallback (lint milestone) | `scripts/ctx/`, `scripts/agents/run.mjs` | alone |
| 10 | [sessions/10.md](sessions/10.md) | skills on the new flow, TEMPLATE removed, end-to-end test | `.claude/skills/`, `.claude/agents/finisher.md`, `session-context.sh`, `runPlan.mjs`, `documents/` | alone |

Every session also owns `documents/plans/agent-pipeline/`. The full Owns list is in each session file.
