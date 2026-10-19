sha: 2ffdab1d
files: —
source: web scouts 2026-10-18 (MCP spec, client docs, GitHub READMEs, arXiv)

# Landscape

## Protocol (spec 2026-07-28)

- Stateless core: no `initialize` handshake or session id; servers implement `server/discover`. Flows that need state pass an explicit handle between tool calls.
- `subscriptions/listen` replaces `resources/subscribe`; list-changed and resource updates arrive on one stream.
- Elicitation works as "pause the tool call, ask the user, retry" (`resultType: "input_required"`), in form and URL modes.
- Deprecated: sampling, roots, logging, HTTP+SSE. Build on none of them.
- Official extensions: MCP Apps (`io.modelcontextprotocol/ui`), Tasks (long jobs, polled), Skills over MCP.
- Tool results carry text, images, audio, resource links and embedded resources; `outputSchema` + `structuredContent` for typed output.
- Sources: https://modelcontextprotocol.io/specification/2026-07-28/changelog, https://modelcontextprotocol.io/extensions/client-matrix

## Client support (verified unless marked)

| Client | MCP Apps | Prompts as slash commands | Local stdio | Notes |
|---|---|---|---|---|
| VS Code Copilot | yes | yes | yes | Extension can register servers; BYOK and Ollama without a Copilot plan |
| Claude Desktop / web | yes, all plans | unverified | Desktop yes | `.mcpb` double-click install; `claude://` deep links |
| Claude Code | no | yes | yes | Elicitation forms; images inline; 25k-token result cap by default |
| ChatGPT | yes | unverified | no | Remote HTTPS or tunnel; plan rules conflict between sources |
| Cursor, Goose | yes | unverified | yes | — |

Gemini CLI was replaced by Antigravity CLI on 2026-06-18 for unpaid users, with a smaller free tier.

## Existing research servers

- Zotero MCP (54yyyu, ~5.5k stars): 53 tools, semantic search, PDF pages as images. Complaints: setup, Python crashes on PDFs, scans return stamp text only, ~17k tokens of tool list.
- arXiv MCP (~3.2k): outline-then-section reading, LaTeX source per section, topic watches.
- paper-search MCP (~2.9k): one search over ~25 sources, open-access download chain.
- Overleaf MCP (~20): static checks, explained compile log; cannot see the rendered PDF, no BibTeX lookup.
- Typst MCP (~183): docs on demand, LaTeX-to-Typst, render to PNG.

No server combines library, PDF and manuscript; none ties a citation to the passage that supports it; none sees the user's selection or open page; almost none previews writes.

## Researcher pain points

- BibTeX from GPT-5, Sonnet 4.6 and Gemini 3 Flash: 50.9% of entries fully correct; deterministic retrieval raises it to 78.3% (https://arxiv.org/abs/2604.03159).
- Generated LaTeX that does not compile; references that change between attempts (Prism reviews, https://library.smu.edu.sg/topics-insights/goodbye-overleaf-exploration-openais-prism).
- PDF parsing of equations, tables and scans; context windows filled by whole papers.
- Tool bloat: 58 tools ≈ 55k tokens per turn; guidance is 10–15 intent-level tools.
- Unreviewable or irreversible writes; unauthenticated HTTP servers.
- Paper text can carry prompt injection.
