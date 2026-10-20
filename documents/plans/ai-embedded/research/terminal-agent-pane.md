sha: 0b367695
files: packages/terminal/src/tui/**, packages/terminal/src/ui/**
source: user product direction, 2026-10-19; terminal interaction catalogue

# Explore the terminal AI pane

## In-app provider experience

The terminal is a candidate surface for embedded AI, using the same API/local provider selection and core operations as the other apps. The first delivery app remains open in the plan.

- A contextual action on a paper, folder, highlight or project problem opens the pane with visible scope.
- Render conversation, selected provider, retrieval activity, cancellation and failures through terminal UI adapters.
- Mark the paper/page under examination in the explorer; accepted changes refresh through the library watcher.
- Keep suggestion review, activity and request-level undo reachable from the pane.
- Use source links according to the existing link contract and report when the configured external PDF viewer cannot open a requested location.

This experience does not require an MCP server or a vendor agent CLI.

## Optional external CLI adapter

Driving an installed agent CLI inside the pane is a separate candidate adapter. Before selecting it, verify vendor support, authentication, terms, stream format, cancellation, capability boundaries and supported platforms. A subscription or sign-in is not interchangeable with the API/local provider setup required by this plan.

Launching the agent in a terminal split, tab or window is an external hand-off owned by [the MCP integration](../../ai-mcp/research/hosts.md). Multiplexer support and CLI-specific flags are not prerequisites for embedded AI.

