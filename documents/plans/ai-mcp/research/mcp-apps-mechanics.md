sha: 0b367695
files: packages/core/src/reader/**, packages/core/src/**/dom/**
source: https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html; https://apps.extensions.modelcontextprotocol.io/

# Render optional LabShelf views in external chats

## Mechanism

An MCP App associates a tool with an HTML UI resource. A compatible host fetches it, renders it in a sandboxed iframe and mediates communication between the view and server. A host without UI support receives useful text/data from the tool.

This places a LabShelf view inside an external host. It does not provide embedded inference inside LabShelf, model downloading, file synchronisation or remote access.

The SDK, resource metadata, notifications, UI-only tool visibility and supported display modes need checking against the selected protocol/host before implementation.

## Candidate constraints to verify

- Measure a self-contained view before selecting a bundler, dependency or reader implementation. Reuse core components and design tokens; do not build a second reader without a measured constraint.
- Verify CSP, network permissions, worker packaging and PDF-byte transfer. Do not assume access to the desktop filesystem or browser extension origin.
- Use the host's supported bridge for source links, navigation, tool calls and model-context updates.
- Preserve state through a defined server/view identity when the host remounts the iframe. Do not assume iframe localStorage or lifecycle behaviour across hosts.
- Distinguish a user viewing a figure from the model receiving that figure as an image. Either route needs explicit size and capability checks.
- UI-only tools should not enlarge the model-visible catalogue where the host/protocol supports that separation.
- A tool call from a widget uses the same confinement, authorisation and write-review rules as a tool called by an agent.
- A context update is not permission to start another model turn or mutate data. Verify host confirmation behaviour.

## Selection gate

Choose a workflow from [widget candidates](mcp-apps-experiences.md), compare it with plain results plus opening LabShelf, and measure whether the interaction earns its payload and setup cost. Reader bundling, chunk sizes, inlining and fullscreen are implementation questions after that gate.
