sha: 144e1b1
source: https://code.claude.com/docs/en/mcp, /settings-reference, /skills, /sub-agents (read 2026-10-16)

# Claude Code settings facts

- `"disableClaudeAiConnectors": true` in any settings scope (or `ENABLE_CLAUDEAI_MCP_SERVERS=false`) stops claude.ai connectors from loading; `true` in any scope wins. Single connectors: `deniedMcpServers`.
- Servers in the project `.mcp.json` are toggled with `enabledMcpjsonServers` / `disabledMcpjsonServers`.
- `disable-model-invocation: true` removes a skill's description from context and from subagent preloading. `user-invocable: false` keeps the description in context.
- Skill descriptions load every session; bodies load on invocation. Agent descriptions load every session; agent prompts load when the agent runs.
- `enabledPlugins` toggles whole plugins only; `skillOverrides` does not apply to plugin skills.
- PostToolUse hook input carries `agent_id` only inside a subagent (used by `.claude/hooks/context-budget.mjs`).
