sha: 2ffdab1d
files: packages/vscode/package.json, packages/browser/manifest*.json, packages/core/src/bridge/**
source: web scout 2026-10-18 (code.visualstudio.com, support.claude.com, developers.openai.com, developer.chrome.com)

# Hosts and hand-off routes

## VS Code

- `vscode.lm.registerMcpServerDefinitionProvider` plus `contributes.mcpServerDefinitionProviders`: the extension registers `labshelf mcp` itself. In stable `vscode.d.ts`; the guide still says preview — check `engines.vscode`.
- Chat participant `@labshelf` with `/commands`; it answers with `request.model`, the model the user picked (Copilot, a BYOK key or Ollama).
- Language Model Tools (`vscode.lm.registerTool`) run in the extension host and can read the active editor directly; a webview selection reaches them only after the webview posts it to the host.
- `workbench.action.chat.open` takes `query`, `isPartialQuery` (fill without sending), `attachFiles` (`{uri, range}`), `mode` and `toolIds` — the "Ask AI" button fills the chat with the selection attached.
- Contribution points `chatSkills`, `chatInstructions`, `chatPromptFiles` ship skills and prompts with the extension. `chatContextProvider` is proposed API, not usable from the Marketplace.
- BYOK covers Anthropic, Gemini, OpenAI, custom endpoints and Ollama, without a GitHub sign-in.

## Claude Desktop and Claude Code

- `.mcpb` Desktop Extension: double-click or drag into Settings; `sensitive` config goes to the OS keychain. Built with `@anthropic-ai/mcpb` (`mcpb pack`).
- Deep links: `claude://claude.ai/new?q=<text>` fills a chat (~14k characters, user sends); `claude://code/new?q=&folder=<dir>` opens a Claude Code session in a folder.
- Claude Code reads the IDE selection through its own IDE bridge (`~/.claude/ide/<port>.lock`); the protocol is undocumented for third parties.
- Channels (server pushes into a running Claude Code session) are a gated research preview; do not depend on them.

## ChatGPT

- Custom MCP servers need public HTTPS or a tunnel; no local stdio. Plan availability of developer mode and write tools conflicts between sources.
- `chatgpt.com/?q=` prefill is reported but undocumented.

## Browser extension

- Native messaging reaches a local process (host → extension messages capped at 1 MB). The extension cannot be an MCP server; the existing native host can start or relay to `labshelf mcp`.
- Content-script injection into chat sites breaks with every site change; prefer deep links and the clipboard.

## Hand-off rule

A hand-off carries a short pointer (`labshelf://focus/<id>`), never the paper itself; the server resolves the pointer, so link length limits do not matter and the context stays fresh.
