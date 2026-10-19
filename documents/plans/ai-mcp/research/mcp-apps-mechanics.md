sha: 2ffdab1d
files: packages/core/src/reader/**, packages/core/src/**/dom/**
source: web scout 2026-10-18 (github.com/modelcontextprotocol/ext-apps spec 2026-01-26, examples/pdf-server, Patterns guide, developers.openai.com/apps-sdk)

# How an MCP App works, and what it means for LabShelf

## Mechanism

- A tool sets `_meta.ui.resourceUri` to a `ui://` resource with mime `text/html;profile=mcp-app`. The host renders that HTML in a sandboxed iframe and talks to it over postMessage (JSON-RPC).
- The UI is one self-contained HTML file (Vite + `vite-plugin-singlefile`); any framework or none. SDK: `@modelcontextprotocol/ext-apps` (`App`), `/server` (`registerAppTool`, `registerAppResource`).
- Host → view: `tool-input`, `tool-input-partial` (streamed arguments, last item may be cut), `tool-result`, `tool-cancelled`, `host-context-changed` (theme, CSS variables, fonts, locale, container size), `resource-teardown`.
- View → host: `tools/call` to our server, `resources/read`, `ui/message` (posts a chat message and starts a turn; host may ask consent), `ui/update-model-context` (replaces what the model knows; may be deferred to the next user message), `ui/open-link`, `ui/request-display-mode` (inline, fullscreen, pip).
- Tools with `_meta.ui.visibility: ["app"]` are hidden from the model: use them for byte streaming, saving and polling.
- Hosts without MCP Apps show the tool's text `content`, so every app tool returns a useful text answer too.

## Constraints

- Default CSP blocks the network (`connect-src 'none'`); inline fonts, scripts and the pdf.js worker, or list domains in the resource's `csp`.
- Popups and plain links are blocked; links go through `openLink` (a `labshelf:` link opens LabShelf at the page).
- PDF bytes travel through an app-only tool in chunks (the reference viewer uses 500 KB base64 chunks with `hasMore`).
- The iframe can remount; keep state on the server and use a view id as a localStorage key.
- Host CSS variables (`--color-*`, `--font-*`, `--border-radius-*`) map onto `--ls-*` tokens; spacing is not provided, so tokens supply it.
- Claude needs domain signing; ChatGPT has extra `window.openai` APIs — feature-detect, never branch on host name.

## Reference: the official PDF viewer

Chunked bytes, real PDF annotations through pdf-lib, the visible page's text sent with `updateModelContext`, and an `interact` tool the model uses to navigate, search, annotate and screenshot. Our reader in core does more and already matches the product look.

## Two-way editing recipe

User edits in the widget → saved through an app-only tool → a short summary or a screenshot goes into `updateModelContext` → only then, optionally, a short `ui/message` starts a turn.

## Streaming recipe (Excalidraw)

Parse `tool-input-partial`, drop the incomplete last item, re-render only when the item count grows, fade in the added items, and send a final screenshot to the model.
