sha: 2ffdab1d
files: packages/terminal/src/cli/**, packages/terminal/src/app/context.ts, packages/terminal/src/library/**
source: packages/terminal/src/cli/usage.ts, documents/apps/terminal.md, this plan's synthesis

# CLI ⇄ MCP: one surface, two doors

## Server commands

- `labshelf mcp` — stdio server on the shared composition root. `--http` serves Streamable HTTP on 127.0.0.1 with a token, for clients that need a URL. `--mode read|propose|write`, `--tools default|all`, `--project <dir>`.
- `labshelf mcp install <client>` — vscode, claude-desktop (writes `labshelf.mcpb` and opens it), claude-code (`claude mcp add`), cursor, codex, goose. `labshelf mcp status` lists where it is installed and whether each client can start it; `labshelf doctor` includes it.
- `labshelf mcp tools [--json]` and `labshelf mcp call <tool> --args '<json>'` run any tool from the shell, for scripts and for tests.

## One command catalogue

- Each command is declared once: name, arguments schema, output schema, handler, write class (read, propose, write). The CLI parser, `--help`, `--json` output, MCP `inputSchema`/`outputSchema` and tool annotations (`readOnlyHint`, `destructiveHint`) come from that declaration.
- A test asserts parity: every tool is a command, and a command's `--json` equals the tool's `structuredContent`.
- The default MCP profile groups commands into ≤ 12 intent-level tools (search, read, cite, edit, build, check, organise, import, focus, activity); `--tools all` exposes one tool per command.

## Agent-friendly CLI (works without MCP)

- `--json` everywhere, stable ids, exit codes that mean one thing (0 ok, 1 findings, 2 missing toolchain or unanswerable question).
- A `SKILL.md` installed by `labshelf mcp install claude-code` teaches the CLI in a few hundred tokens; agents that prefer the shell use it instead of the tool list (the Zotero CLI + skill route costs ~100 tokens against ~17k for its MCP tool list).
- Answers print `labshelf:key#p5` links as OSC 8 hyperlinks; `labshelf open <link>` opens the PDF at the page.

## Shared live state with the TUI

- The TUI writes the focus record (selected folder, paper, preview page, search query, project and problem under the cursor) on every move; `labshelf://focus` serves it.
- The server appends each AI action to an activity journal in the state folder. The TUI shows it live: a status-line segment ("AI: tagging 14 papers"), a mark on the row and page the AI touches, and `:activity` with undo per entry.
- `labshelf undo [--last | <activity-id>]` reverts one AI request; the TUI binds it to `u` in `:activity`.
- In propose mode, writes wait in `:inbox` (TUI) and `labshelf review` (CLI): a diff per item, `a` accept, `r` reject, `A` accept all.
- `labshelf build --watch` and the server share the project build queue; `build_status(wait: true)` returns as soon as the running build ends, so the AI never starts a second build.

## Recipes

- `labshelf recipes` lists the prompts the server also serves (explain, related-work, fix-build, review, rebuttal), and `labshelf recipe <name> [args]` prints the filled prompt, ready to pipe into any agent CLI.
- CI: `labshelf check --json` output feeds an agent step that opens review comments; the same tools run headless with `--mode propose`.
