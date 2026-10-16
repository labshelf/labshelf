sha: 144e1b1
files: .claude/agents/*.md, .claude/skills/check/SKILL.md, .claude/skills/finish/SKILL.md, .claude/settings.json, .mcp.json
source: node scripts/agent-tokens.mjs and first-turn usage from transcripts of five recent plan sessions, 2026-10-16

# Baseline measurements

- Main thread, first turn of a fresh session: ≈52k tokens.
- Subagents without a `tools:` list (`implementer`; `general-purpose`, which `check` and `finish` fork onto through `agent: general-purpose`): first turn ≈37–39k.
- Subagents with a restricted list (`commit-splitter`, `Explore`): first turn ≈11k.
- 6 of 8 implementers in those sessions passed 60k (73k–137k).
- Main threads peaked at 207–211k over 63–75 turns; no single tool result passed 11k. The growth is accumulation.
- Plans are read in pieces by the main thread, implementers (`grep -A40`), commit-splitter (plan diffs) and check agents.
- Launch counts across all project transcripts: `general-purpose` ≈130, `implementer` ≈88; `pr-review-toolkit` and `code-simplifier` agents 0.
- `verify` uses Playwright's Chrome for Testing, not the chrome-devtools MCP declared in `.mcp.json`.
