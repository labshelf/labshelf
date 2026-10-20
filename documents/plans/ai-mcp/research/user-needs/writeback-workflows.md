sha: 0b367695
files: —
source: primary-source user/developer requests, 2025–2026; reviewed 2026-10-19

# Return external work to the research library

Writes are a separate product decision from the initial read-only experiment. [Review rules](../../../ai-embedded/research/interaction-patterns.md) define the candidate shared boundary.

## Located notes and highlights

A developer running an AI research pipeline wants extracted insights stored as highlights and notes visible in Zotero's PDF reader beside manual annotations. The request also covers transferring annotations from other readers. This is an integration request, not evidence of broad end-user adoption.

Source: [Zotero forum request, 2026-06-18](https://forums.zotero.org/discussion/132273/feature-request-expose-api-for-programmatic-pdf-annotation-creation-highlights-notes).

Candidate: propose sourced notes/highlights from an external analysis, review their placement and authorship, then persist through annotation contracts.

## Organise a large collection

A user asks how to organise about 3,500 papers with AI; replies include the same unmet need and difficulty building a topic-based solution. A Paperpile user explicitly asks to use an external coding agent for organisation without manual BibTeX/CSV export.

Sources: [Zotero user thread](https://www.reddit.com/r/zotero/comments/1nj3yib/how_to_use_llm_to_organize_my_zotero_paper_folders/), [Paperpile request, 2026-02-11](https://forum.paperpile.com/t/feature-request-integration-with-openai-claude-etc/11763/16).

Candidate: propose folders/tags and metadata corrections before applying them. This is distinct from proving that an autonomous reorganisation is safe or desirable.

## Import and complete papers

An active MCP user requests attaching supplementary files to existing papers and renaming actual attachment filenames, not just display titles. A separate technical-research request asks for bulk DOI-based enrichment of incomplete bibliographic data.

Sources: [Zotero MCP #377](https://github.com/54yyyu/zotero-mcp/issues/377), [metadata enrichment #216](https://github.com/54yyyu/zotero-mcp/issues/216).

[Owned-paper access](library-access.md) also includes finding genuinely missing papers before downloading. Candidate: confirmed import, correct parent attachment, duplicate detection and review of uncertain metadata matches.

A tool author describes finding papers, filing them in Zotero and sending them to an e-reader; a commenter asks to sync e-reader annotations back. The return path is a request, not a demonstrated implementation.

Source: [Paperboy discussion, 2026-07-13 onward](https://www.reddit.com/r/zotero/comments/1uuynmd/i_made_an_opensource_mcp_server_to_manage_papers/).

## External editing

Overleaf MCP commenters ask to write from VS Code, preserve formatting and handle concurrent changes. One reports useful actual use with a sync caveat. This is a small sample.

Source: [Overleaf MCP user comments, 2026-03 onward](https://www.reddit.com/r/mcp/comments/1rp4hyv/opensource_mcp_server_for_overleaf_read_latex/).

Candidate: connect external work to the active project with explicit review and conflict handling. Generic rewriting alone does not establish a need for LabShelf MCP; local agents may already edit the manuscript.
