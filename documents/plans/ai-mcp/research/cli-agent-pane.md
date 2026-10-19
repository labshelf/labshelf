sha: 2ffdab1d
files: packages/terminal/src/tui/**, packages/terminal/src/ui/**
source: this plan's synthesis; vendor CLIs' documented flags; terms not yet checked

# The TUI agent pane

Goal: a chat beside the explorer, with no API key, using an agent CLI the user already has.

## Launch from the explorer

- `A` on a paper, folder, highlight or project problem opens an agent beside the explorer, already pointed at the focus record.
- Inside a multiplexer or a split-capable terminal (tmux `split-window`, kitty `@ launch`, WezTerm `cli split-pane`, Ghostty, iTerm2) the agent runs in a real split; elsewhere it opens a terminal tab or window.
- The command is the user's choice: `claude "<prompt>"`, `codex "<prompt>"`, or an Ollama-backed agent. The prompt is short ("Use labshelf focus") because the server holds the context.
- `labshelf mcp install` has already registered the server with that agent, so the pane starts connected.

## Embedded chat (Q3 in plan.md)

- A pane inside the TUI that drives an agent CLI headless (`claude -p --output-format stream-json`, `codex exec --json`, Ollama's API) and renders the stream with the TUI's own widgets, so the chat looks like LabShelf.
- Tool calls by the agent show inline as compact rows ("read vaswani2017 §3", "proposed edit to intro.tex") with the same activity and undo as everywhere.
- Ollama runs fully local and free; Codex uses the user's ChatGPT sign-in; Claude Code uses the user's own plan. Whether a vendor allows its CLI to be driven by another app must be checked against its terms before shipping that adapter.

## Explorer reacts to the agent

- The row and page the agent reads are marked; a written paper refreshes through the library watcher; build problems the agent fixes disappear from the Writing pane as the watch build passes.
- `:inbox` and `:activity` sit one key away while the agent works.

## Hand-off out of the terminal

- `labshelf ask [--to claude|chatgpt|vscode] [<id>]` opens the chosen chat with a focus pointer (`claude://claude.ai/new?q=…`, VS Code `chat.open`), for users who prefer a desktop chat.
