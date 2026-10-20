sha: 0b367695
files: packages/terminal/src/app/context.ts, packages/core/src/bridge/**, packages/vscode/src/extension.ts, packages/browser/manifest*.json
source: user access questions, 2026-10-19; https://ts.sdk.modelcontextprotocol.io/v2/clients/connect

# Connect an external agent to local research data

## Local access

A compatible client starts `labshelf mcp` as a local child process and communicates over stdio. The process reads the authorised library through core operations. Closing the client ends that connection; another client can start its own process.

Saved-library access does not require the VS Code or browser UI. Reading the visible page, current selection or unsaved text needs the corresponding running app and a defined local context bridge. If focus persists, it is per-machine state outside the synced library, with freshness and availability checks.

| Situation | Requirement |
|---|---|
| Same computer as the library | Installed MCP runtime, accessible files and a compatible configured client |
| Another computer with a synced copy | Its own runtime/client setup and available local files |
| Another computer without the files | Explicit authenticated remote access to a running server, or an authorised cloud-data integration |
| Phone or web-only client | A supported remote connection or a separately supported on-device runtime; sync/login alone is insufficient |

Remote access to a desktop requires that computer and server to remain reachable. A cloud-data integration needs its own service/runtime, provider authentication, storage semantics and privacy decisions. It is not implicit in local-first folder sync.

API-based embedded inference can send requested content to a provider, but that request does not make the local MCP reachable remotely.

## Host candidates

VS Code chat, desktop clients and terminal agents are candidates, not an assumed support matrix. For the selected version, verify process installation, local versus remote transport, image output, tool discovery, result limits, permissions and optional MCP Apps support.

The browser extension can use a native-host adapter when a chosen integration needs local process access. A browser page does not inherit Node access, and a hosted chat cannot reach a user's localhost by knowing its URL.

## Hand-off candidates

An Ask AI action can open or prefill an external chat where documented. A focus pointer resolves only if that client has an authorised route to the appropriate library and machine context; it does not transport files or establish access.

A terminal action can launch an external agent in a split/tab/window when the host supports it. That is distinct from [the embedded terminal pane](../../ai-embedded/research/terminal-agent-pane.md). Client-specific deep links, installers and vendor CLI execution remain implementation investigations.
