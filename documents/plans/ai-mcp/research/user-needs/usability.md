sha: 0b367695
files: —
source: primary-source user reports, 2025–2026; reviewed 2026-10-19

# Keep external integration small and usable

## Startup context and tool selection

A user reports roughly 12,500 context tokens from Zotero MCP and asks to expose only semantic search, metadata and full text. This is a measurement reported for that setup, not a universal current token cost.

Source: [Zotero MCP #71, 2025-10-14](https://github.com/54yyyu/zotero-mcp/issues/71).

Another user says the model struggles to choose among many functions, wants mostly search/full text and would remove write access.

Source: [Zotero MCP #62, 2025-09-19](https://github.com/54yyyu/zotero-mcp/issues/62).

A DEVONthink participant prefers equivalent CLI/skill access for a shell-capable agent to reduce context overhead. This is a preference in an exploratory thread, not a benchmark of CLI superiority.

Source: [DEVONthink discussion](https://discourse.devontechnologies.com/t/what-would-you-do-with-an-mcp-server/86828/2).

Implication: start with the smallest task-complete read surface, avoid redundant tools and measure actual client discovery/injection behaviour. Do not assume fewer names or lazy discovery guarantees smaller total task cost.

## Returned content

A user reports a full-text response of 29,195 tokens rejected by a client limit of 25,000. Another researcher requests pagination and explicit token budgets for search and full-text results.

Sources: [Zotero MCP #50](https://github.com/54yyyu/zotero-mcp/issues/50), [budget request #217](https://github.com/54yyyu/zotero-mcp/issues/217).

Implication: separately measure startup schemas, returned passages/images, round trips and correctness. Offer bounded portions and continuation; avoid dumping a paper or index into each conversation.

## Setup and trust

The Zotero discussion includes installation failures, requests for a comprehensible guide, security questions and concern about indexing a 12,000-item library. Tool promotions in the same thread are not separate user validation.

Source: [Zotero user discussion](https://www.reddit.com/r/zotero/comments/1lqjpl6/anyone_using_zotero_with_mcp_model_context/).

Implication: test setup and indexing cost on realistic libraries; expose availability and failures clearly. Failed retrieval must not look like a successful empty result.

## Mobile and remote expectations

A DEVONthink user asks for iOS access while recognising that synced database files do not provide a running remote service. They discuss an always-on desktop and an authenticated route as additional requirements.

Source: [DEVONthink access discussion](https://discourse.devontechnologies.com/t/what-would-you-do-with-an-mcp-server/86828/2).

[Host boundaries](../hosts.md) owns the proposed LabShelf access model. This request does not select a tunnel, cloud service or provider adapter.

## MCP Apps evidence

The reviewed sample supports data access, source navigation and cross-tool workflows. It does not establish enough demand to prioritise chat widgets. Test any [visual interaction](../mcp-apps-experiences.md) against plain results plus opening LabShelf.
