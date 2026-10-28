# Conventions for sessions 2–10

Shared rules every package brief relies on. Briefs say "per conventions" instead of repeating them.

## Scripts

- Files are camelCase `.mjs` (CLI entry points may be short lowercase names: `run.mjs`, `plan.mjs`, `ctx.mjs`). Argument parsing in the style of `parseArgs` from `scripts/codemods/shared.mjs`.
- Telemetry: `import { emit } from "<rel>/scripts/agents/telemetry.mjs"`; `emit(kind, fields)` never throws. Kinds and fields: `research/telemetry-events.md`. Shell hooks use `node scripts/agents/telemetry.mjs <kind> '<json>'`.
- Handoff blocks: `parseBlocks` and `validate` from `scripts/agents/schemas.mjs` (from session 3 on). Fields: `research/schemas.md`.
- Tests: `node:test` in `scripts/<dir>/__tests__/*.test.mjs` or `.claude/hooks/__tests__/*.test.mjs` (both already in `pnpm test:tooling`). Temp dirs from `fs.mkdtempSync(os.tmpdir())`; never write into the real `.git/`: every state path takes an env override (`LABSHELF_RUNS_DIR`, `LABSHELF_LOGS_DIR`, `LABSHELF_CTX_DB`, `LABSHELF_HOOK_STATE_DIR`, `LABSHELF_TELEMETRY_SPOOL`).
- From session 2.1 on, run tests through the wrapper: `node scripts/agents/run.mjs test tooling -- <test path>`; raw `node --test` is denied once 2.2 registers its hook.

## State paths (all under `.git/`, never committed)

| Path | Written by | Read by |
|---|---|---|
| `.git/labshelf-logs/<stamp>-<kind>.log` | `run.mjs` | agents, `arbiter` |
| `.git/labshelf-runs/<plan>/<id>.json` | `run.mjs test --spec` | `run.mjs`, `check-handoff` |
| `.git/labshelf-runs/<plan>/<id>.report.yaml` | `check-handoff` | `plan close`, orchestrator |
| `.git/labshelf-runs/<plan>/<id>.patch` | `plan close` | orchestrator, next session |
| `.git/labshelf-red.json` | `plan red` | `plan red --restore` |
| `.git/labshelf-ctx.db` | `scripts/ctx/` | `ctx` CLI, `plan size` |

## Hooks

- Read the JSON input from stdin; on any internal error exit 0 with no output (a hook never breaks a session). Deny shape: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` (model: `.claude/hooks/guard-processes.sh`). SubagentStop block: `{"decision":"block","reason":"…"}` (unusable, P2; `check-handoff.mjs` uses PostToolUse on `Agent` with `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"…"}}` instead).
- `agent_type` names the agent; the main thread has no `agent_id` (`research/findings.md` § Claude Code).
- The subagent's prompt (and so its `spec/v1` block) is the first user line of `join(dirname(transcript_path), session_id, "subagents", "agent-<agent_id>.jsonl")` (`.claude/hooks/context-budget.mjs:44-48`); prefer `agent_transcript_path` when the input has it.
- Per-agent state (block counts, parsed spec cache, quotas) lives in `$LABSHELF_HOOK_STATE_DIR` or `os.tmpdir()/labshelf-hooks/<session_id>/<agent_id>.json`.
- Tests feed synthetic stdin and synthetic transcripts (pattern: `writeSession` in `.claude/hooks/__tests__/context-budget.test.mjs`).
- Registration: the package that writes a hook adds it to `.claude/settings.json` only after its tests pass, with a `timeout` (5 s unless the brief says otherwise). Check `research/hook-probes.md` (session 1) before relying on a hook behaviour.
