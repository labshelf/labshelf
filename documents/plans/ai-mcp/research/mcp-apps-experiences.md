sha: 0b367695
files: packages/core/src/reader/**, packages/core/src/libraryUi/**, packages/core/src/writing/**
source: conversation synthesis, 2026-10-19; linked user needs and product idea catalogues

# Explore optional interfaces inside external chats

The [user reports](user-needs/) support access to research data and cross-tool work. This sample does not establish enough demand to prioritise MCP Apps. These are interaction hypotheses, not promised widgets or extra default tools.

| External task | Candidate interface | Evidence boundary |
|---|---|---|
| Find and verify evidence | Result cards with paper, page, excerpt and Open in LabShelf | Source retrieval has user evidence; cards need comparison against text |
| Compare papers for a review | Evidence matrix with source links and missing-value markers | Table extraction has direct requests; interactive chat rendering is a hypothesis |
| Save external analysis | Review notes/highlights against original passages before confirmation | Write-back has requests; placement/review inside chat remains open |
| Import missing sources | Candidate and destination-folder picker | Import has user demand; the interaction can also live in LabShelf |
| Review manuscript proposals | Diff with Accept, Reject and Edit | Requires explicit write scope and the shared suggestion/undo contract |
| Discuss a figure | Core reader/region with page navigation and annotations | Model access to the image works without a widget |

The [reading](../../ai-embedded/research/reading.md) and [writing](../../ai-embedded/research/writing.md) catalogues own the broader product ideas. A selected core surface may serve an external view; the catalogues are not a requirement to embed the whole app in a chat.

[Mechanics](mcp-apps-mechanics.md) owns host constraints. [External access](hosts.md) owns transport and locality: rendering a widget does not make a local library available on a phone.
