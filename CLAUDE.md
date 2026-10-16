@AGENTS.md

## Claude Code in this repo

Talk to the user in the language they write in. Everything committed to the repo is in English.

### Model routing

- **Haiku** — machine-checkable output: `check`, `commit-splitter`, `changelog-writer`, `import-validator`.
- **Sonnet** — work with explicit acceptance checks: `Explore`, `implementer`, `module-splitter`, `test-writer`, `code-mapper`, `finish`.
- **Opus/Fable** — contracts, new abstractions, cross-app design, prompt writing, and a bug that survived one Sonnet attempt.

A Sonnet package that fails twice moves to Opus. If the user assigns a model to part of the work, follow it.

### Working style

- Multi-file work goes through `orchestrate`; an idea or opinion goes through `brainstorm` (no files until approved). Small changes are done directly.
- A plan session reads only its own session file (see `orchestrate`, "Running a plan file").
- Delegated prompts are self-contained: agents do not see this conversation.
- No ceremony the user did not ask for: no extra logs, no rereading logs, no per-package gates, no `verify` runs unless asked.

### Hooks

`session-context.sh` gives the branch, uncommitted work and active plans at start; use it instead of re-deriving them. `check-rules.sh` reports AGENTS.md size/shape and writing regressions after edits; fix them in the same change. `context-budget.mjs` warns past 60k (subagent) or 150k (main thread). Auto-compaction is off.
