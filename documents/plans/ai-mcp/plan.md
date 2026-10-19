# Plan: LabShelf over MCP

Status: draft
Size: not split — the idea catalogue in [research/](research/) comes first; sessions follow once the decisions below are approved.

## 1. Goal

Researchers use the AI they already have (Copilot, Claude, Codex, a local model) on their library and writing projects, at no cost to LabShelf. The app knows what the user is looking at, the MCP server gives the AI hands, and every AI change shows up in LabShelf where the user reviews and undoes it.

## 2. Decisions

- [ ] **D1** One MCP server, `labshelf mcp`, in `packages/terminal`, started from the composition root the CLI and TUI share (`packages/terminal/src/app/context.ts`). VS Code registers it and the browser reaches it through the native host; no second server — one implementation, Node only, no Python install.
- [ ] **D2** One command catalogue feeds CLI arguments, `--help`, `--json` output and MCP tool schemas; a test asserts that every tool is a command and every command's JSON matches its tool's output schema — [research/cli-integration.md](research/cli-integration.md).
- [ ] **D3** The default tool profile holds at most 12 intent-level tools and reads in tiers: outline, then section, then page — a long tool list costs tens of thousands of tokens per turn ([research/landscape.md](research/landscape.md)).
- [ ] **D4** The model never writes BibTeX or library files itself: it cites by paper id, edits arrive as suggestions, and one AI request is one undo step — [research/interaction-patterns.md](research/interaction-patterns.md).
- [ ] **D5** The focus record (what the user is looking at) lives in the per-machine state folder, outside the library, so sync tools never copy it. Its shape becomes a contract in `documents/contracts/`.
- [ ] **D6** No sampling (deprecated in the 2026-07-28 spec). Confirmations use elicitation; content reaches a chat only through MCP Apps or a hand-off the user starts.
- [ ] **D7** `labshelf.yaml` is never writable over MCP, because it holds commands the apps run. Paths stay confined to the library root, and paper text is marked as untrusted data in every tool result.

Open (blocks approval):

- **Q1** First client — VS Code (extension registers the server; Copilot, BYOK keys or Ollama) / Claude Desktop (`.mcpb` and MCP Apps); recommendation: VS Code, because it needs no install step and runs with a local model.
- **Q2** Default write mode — read-only / propose / write; recommendation: propose, so every write lands in the review inbox first.
- **Q3** TUI chat pane that drives an agent CLI (`claude -p`, `codex exec`, Ollama) — depends on each vendor's terms for being driven by another app; recommendation: Ollama and Codex first, Claude after a terms check ([research/cli-agent-pane.md](research/cli-agent-pane.md)).
- **Q4** MCP App bundle — reuse the core reader in one inlined HTML / write a lighter viewer; recommendation: spike the core reader first and measure bundle size and pdf.js worker inlining.

## 3. Acceptance (draft)

- [ ] **A1** After installing the VS Code extension, Copilot Chat lists LabShelf tools, and "what am I reading?" answers with the open paper and page.
- [ ] **A2** In Claude Desktop, double-clicking `labshelf.mcpb` installs the server, and "show me Figure 3 of vaswani2017" renders the reader widget at that page.
- [ ] **A3** An AI edit to `main.tex` appears in the editor as a suggestion, and one undo reverts the whole request.
- [ ] **A4** The cite tool rejects keys that are not in the library, and bib entries come from `metadata.yaml`.
- [ ] **A5** In the TUI, `A` on a paper opens an agent pane beside the explorer that already knows the paper, and the explorer shows what the agent is reading.

## 4. Sessions

Not split yet.
