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

### Skills and agents

Skills: `brainstorm` (think an idea through with the user; no files touched until approved; ends in a plan from `documents/plans/TEMPLATE.md`), `orchestrate` (also runs an approved plan: `/orchestrate documents/plans/<slug>.plan.md`), `finish`, `check`, `ship` (finish + commits), `verify` (run an app for real), `refactor-step` (advance the architecture refactor plan), `health` (repo-wide audit).

Agents: `Explore`, `implementer`, `code-mapper`, `module-splitter`, `import-validator`, `dead-code-cleaner`, `comment-enforcer`, `doc-keeper`, `architecture-reviewer`, `test-writer`, `bug-tracer`, `commit-splitter`, `changelog-writer`. Each agent's model is set in its frontmatter. Agents without a model run on Sonnet (`CLAUDE_CODE_SUBAGENT_MODEL` in `.claude/settings.json`).

### Plugins (project scope)

| Plugin | Adds |
|---|---|
| `typescript-lsp` | go-to-definition and references (needs `typescript-language-server` on PATH) |
| `playwright` | browser automation for the webview and browser-extension checks |
| `context7` | current docs for pdf.js, MV3, the VS Code API |
| `pr-review-toolkit` | `/review-pr` and its review agents |
| `code-simplifier` | simplification pass |
| `hookify` | create more hooks from a conversation |
| `frontend-design` | UI design skill, also for the website |

Plugin agents set their own models: `code-simplifier` and `pr-review-toolkit`'s `code-reviewer` run on Opus, and the other review agents inherit yours. Launch them with `model: "sonnet"` unless the review really needs more.
