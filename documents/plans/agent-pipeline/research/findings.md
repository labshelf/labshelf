# Findings from the planning scouts (2026-10-27, main at 3296ad93)

Facts the sessions rely on. Briefs point here by section instead of re-scouting.

## Claude Code 2.1.308 (docs: hooks.md, headless.md, cli-reference.md, monitoring-usage.md)

- PreToolUse: `permissionDecision: "deny"` + `permissionDecisionReason` blocks the call and shows the reason to the model (used today by `.claude/hooks/guard-processes.sh` and `guard-doc-reads.sh`). `updatedInput` exists but is not explicitly confirmed for built-in Bash: do not rely on it.
- PostToolUse: `updatedToolOutput` exists (Bash shape `{stdout, stderr, interrupted, isImage}`), not confirmed inside subagents: do not rely on it. `decision: "block"` does not hide the output.
- Hook input inside a subagent carries `agent_id` and `agent_type` (the agent name, e.g. `implementer`). Main thread: no `agent_id`.
- SubagentStop input: `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`, plus `session_id`, `transcript_path`, `cwd`. Block with `{"decision":"block","reason":"..."}` or exit 2 with stderr; the subagent continues. Claude Code caps at 8 consecutive continuations.
- Subagent transcript when only `agent_id` is known: `join(dirname(transcript_path), session_id, "subagents", "agent-<agent_id>.jsonl")` (`.claude/hooks/context-budget.mjs:44-48`). Its first user line holds the prompt.
- Headless: `claude -p "/orchestrate …"` runs skills; project hooks, agents and skills load. Flags: `--permission-mode auto`, `--permission-prompts none` (removes AskUserQuestion), `--max-turns`, `--max-budget-usd` (includes subagents), `--output-format stream-json --verbose`, `--append-system-prompt`. No env var marks a headless run.
- No hook field carries the subagent model or cumulative cost; cost comes from the transcripts (agent-telemetry ETL) or the `-p` result `total_cost_usd`.

## Repo tooling

- Runner `scripts/plans/runPlan.mjs` (287 lines, no tests): args :21-37; `ensureBranch` :57-65 (moves off main to `refactor/<slug>`); `UNATTENDED`/`MILESTONE`/`RESUME` prompts :67-101; session order `pendingSessions` :39-53 (globs `sessions/*.md`, numeric prefix then suffix; strips 3 chars at :52); usage-limit probe and wait :103-159; spawn + stream-json + 60-min stall watchdog :161-210; preconditions :212-227 (`Status:` approved|in progress, clean tree unless `--resume`); main loop :236-280 (done = session file deleted and HEAD advanced and tree clean; `MAX_CONTINUES` 3). Logs `.git/plan-runs/<slug>/<session>-<stamp>.jsonl`. npm alias `pnpm plan:run`.
- Hooks in `.claude/settings.json`: PreToolUse Bash → `guard-processes.sh`; PreToolUse Read → `guard-doc-reads.sh`; PostToolUse Edit|Write|MultiEdit → `check-rules.sh` (15 s); PostToolUse `*` → `context-budget.mjs` (5 s); SessionStart → `session-context.sh`. No SubagentStop hook.
- `context-budget.mjs`: budgets `{main: 150_000, subagent: 60_000}` :6, messages :11-12, role from `agent_id` :74, state dir `LABSHELF_BUDGET_STATE_DIR` or tmp, `off/<session_id>` disables.
- Hook tests: `.claude/hooks/__tests__/context-budget.test.mjs` (node:test, synthetic transcripts via `writeSession`); `check-rules.test.sh` (bash, temp repo per case, not in `test:tooling`). `test:tooling` (root `package.json:8`) = `node --test` over `scripts/*/__tests__/*.test.mjs`, `tools/*/__tests__/*.test.mjs`, `.claude/hooks/__tests__/*.test.mjs`.
- `session-context.sh:27-46` counts `[ ]`/`[x]` over `sessions/*.md`, finds "next" as the first table row with `[ ]` in lexical file order (bug: `10.md` before `2.md`), reads `Status:` from `plan.md`. RULES heredoc :8-16 names `implementer`, `explorer`, `general-purpose`.
- Agents: `explorer.md` (37 lines, Brief template), `implementer.md` (43 lines, CHANGES/TESTS/ACCEPTANCE/NOT TOUCHED/CONCERNS), `diagnose.md` (39 lines; referenced nowhere else), `finisher.md` (8 lines, shell for the `finish` skill). No `AGENTS.md` or `CLAUDE.md` in the repo root.
- Skills: `orchestrate` (SKILL.md + references `planning.md`, `run-plan.md`, `handoff.md`), `finish` (+ `references/session.md`, `plan.md`; forks into `finisher`), `verify`, `brainstorm` (writes plans from TEMPLATE).
- Gate `scripts/lint/gate.mjs`: steps typecheck, test, lint per touched package (`pnpm --filter @labshelf/<pkg> <step>`), plus `scripts/lint/modules.mjs` once; `--no-lint`; caches PASS in `.git/labshelf-gate`; prints ≤15 error lines.
- Packages: all four use jest (`core`: `node --experimental-vm-modules node_modules/jest/bin/jest.js`; others `jest`); `-t <name>` works; globs `**/__tests__/**/*.test.ts`. Typecheck `tsc --noEmit -p ./` (core also `-p tools/pdf-eval`, vscode also `-p tsconfig.webview.json`).
- Codemods `scripts/codemods/`: `shared.mjs` exports `toolRoot`, `ts` (typescript v6 JS API via core's `typescript-js` alias), `CODE_EXTENSIONS`, `listFiles`, `parseArgs`; `moveFiles.mjs` (TSV, rewrites imports, `jest.mock` paths); `renameSymbol.mjs`; tests with `__tests__/fixture.mjs`.
- Plan format: TEMPLATE `plan.md` (Status, Decisions, Acceptance, Sessions table), `sessions/1.md` (Goal/Starts from/Ends with/Owns, package table with OK column, one `## <id>` brief per package), `log.md` append-only. Commits today: per session in the main thread after `finish session`; English subject; trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Naming lint `scripts/lint/bannedWords.mjs` covers only `packages/*/src` and `__tests__`; script files are camelCase `.mjs`.

## Index feasibility

- TypeScript 7.0.2 (native) has only `unstable/*` APIs; `typescript@6.0.3` is installed as `typescript-js` (slow LanguageService). Use `oxc-parser@0.150.0` (parse, `module.staticImports`/`staticExports`, `Visitor`) and `oxc-resolver@11.24.2`; both are only transitive (via knip) and must be added and pinned.
- No tsconfig `paths` except `packages/core/tsconfig.test.json:12-19`; imports use NodeNext `.js` specifiers (resolver `extensionAlias` `.js → .ts/.tsx`); `@labshelf/core` resolves through the workspace link to core's package.json `exports` (map it to `packages/core/src/index.ts`).
- `node:sqlite` `DatabaseSync` with FTS5 works on Node 26.11.1. No sqlite npm package needed.
- ollama: `POST localhost:11434/api/embed {"model":"nomic-embed-text","input":[...]}` → 768 dims, ~31 ms warm per short input; batching by array.
- Size: 1,978 tracked `.ts/.tsx/.mjs/.css` files in `packages/` and `scripts/`, 214k lines; most files open with a `// ` capability header (take only the leading comment block).

## agent-telemetry (`/Users/lucanasser/Developer/pessoal/agent-telemetry`, not a git repo, Python 3 stdlib)

- `capture/capture.sh` appends hook events to `data/events/<day>.jsonl`; `etl/etl.py` loads transcripts and spools incrementally by byte offset (`load_events` :328-343; glob :388-389; `SOURCE_TABLES` :35; `SCHEMA_VERSION = 3`; rewritten files reload ~:397); `etl/schema.sql` DDL; `etl/derive.py` `derive_plans` :111-131 (slug regex :8) fills `session_plans`; `report/report.py` sections are methods called from `build()` (~:405; example `plans()` :214-220; helpers `h`, `t`, `q`, `p`, `tok`, `usd`, `pct`); `run-nightly.sh` runs etl → classify → report at 03:30 via launchd.
- Tables: `sessions`, `agents(session_id, agent_id, agent_type, model_requested, …)`, `requests`, views `request_costs`, `agent_tokens`, `session_tokens` (with `plan_slug`), `hook_events` (+ `extra` JSON), `session_plans`.
- Local model convention (`classify/classify.py:27-28, 113-158`): `qwen3.5:9b` at `http://localhost:11434/api/chat`, `stream:false`, `think:false`, `temperature:0`, `ollama_up()` via `/api/tags` first, cache by sha256.
