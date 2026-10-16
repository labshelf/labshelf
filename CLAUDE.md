@AGENTS.md

## Claude Code in this repo

Talk to the user in the language they write in. Everything committed to the repo is in English.

### Model routing

Route by the kind of judgment the work needs, not by task size:

- **Haiku** — only when the output is machine-checkable: `check` (typecheck/test gates), `commit-splitter`, `changelog-writer`, `import-validator`.
- **Sonnet** — explicit acceptance checks exist: `Explore` scouts, `implementer`, `module-splitter`, `test-writer`, `code-mapper`, and the `finish` skill (dead code, comments, docs, architecture review).
- **Opus/Fable** — contracts, new abstractions, cross-app work, prompt writing, and a bug that survived one Sonnet attempt. This is also the session model's own default work.

Escalation: a Sonnet package that fails its acceptance checks twice, or that reports concerns instead of a result, moves to Opus — never a third Sonnet retry. Every agent returns a capped, fixed-format report.

For any request spanning several files or packages, start with the `orchestrate` skill; for an idea or opinion, use `brainstorm` instead — no files and no plan until approved. Do not sweep the codebase, read test logs, run check loops, update `documents/`, apply the comment standard, or hunt dead code yourself — `Explore`, `check` and `finish` do that. Agents do not see this conversation: every delegated prompt is self-contained (goal, brief, files, what not to touch, acceptance checks). If the user assigns a model to part of the work, follow it.

### Hooks

At session start (and after `/clear` or compaction), `.claude/hooks/session-context.sh` adds a few lines of context: the branch, uncommitted work by area, and the active plans with their open items and next step. Use them; do not re-derive them by reading files.

After every Edit/Write, `.claude/hooks/check-rules.sh` reports regressions against AGENTS.md: a file over its line limit, a directory over 8 source files, or history language and `@depends`/`@usedBy` lists in comments or docs. It runs outside the model and costs nothing until it fires. When it fires, fix the issue in the same change. It compares against `HEAD`, so uncommitted or untracked files count as new.

After every tool call, `.claude/hooks/context-budget.mjs` warns once when the running agent's context passes its budget: 60k tokens for a subagent, 100k for the main thread. A subagent then returns what is left; the main thread finishes its step and hands off to a fresh session. Auto-compaction is off for this project. `node scripts/agent-tokens.mjs [session]` reports each agent's peak context, largest tool results and repeated reads; `pnpm test:tooling` tests both.

After every Read, Grep, Glob or Bash call that names `packages/`, `.claude/hooks/read-budget.mjs` adds the size of the result to a per-session total and, once the main thread has read 60k characters, tells it once to delegate further reading of `packages/` to an `Explore` scout.

### Skills and agents

Skills: `brainstorm` (think an idea through with the user in spar, grill or council mode; no files touched until approved; ends in a plan directory from `documents/plans/TEMPLATE/`), `council` (four opposed personas and a judge on one hard-to-reverse fork; about 200k subagent tokens), `retro` (turns this session's mistakes into checks and rules after approval), `orchestrate` (also runs an approved plan: `/orchestrate documents/plans/<slug>/plan.md`), `finish`, `check`, `ship` (finish + commits), `verify` (run an app for real), `ui-design` (UI in the apps: core tokens, components, icons, vocabulary), `health` (repo-wide audit). `ship`, `retro`, `health` and `brainstorm` run only when the user types them.

Agents: `Explore`, `implementer`, `code-mapper`, `module-splitter`, `import-validator`, `dead-code-cleaner`, `comment-enforcer`, `doc-keeper`, `architecture-reviewer`, `test-writer`, `diagnose`, `commit-splitter`, `changelog-writer`, `gate` (runs `check` and `health`, read-only), `finisher` (runs `finish`). Each agent's model is set in its frontmatter. Agents without a model run on Sonnet (`CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json`).

### Plugins (project scope)

| Plugin | Adds |
|---|---|
| `typescript-lsp` | go-to-definition and references (needs `typescript-language-server` on PATH) |
| `context7` | current docs for pdf.js, MV3, the VS Code API |

