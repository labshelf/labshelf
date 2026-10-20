sha: 0b367695
files: —
source: primary-source user requests, 2025–2026; reviewed 2026-10-19

# Ground literature work in located evidence

These are external task candidates, not proposed tool names. The same core retrieval can serve [embedded reading](../../../ai-embedded/research/reading.md) or [writing](../../../ai-embedded/research/writing.md).

## Evidence and reverse source lookup

A Paperpile user asks a biological evidence question and wants pointers to relevant paragraphs in relevant papers.

Source: [Paperpile request, 2025-12-05](https://forum.paperpile.com/t/feature-request-integration-with-openai-claude-etc/11763/4).

A researcher describes having a quotation, equation or numeric claim in notes and needing its source paper and page; their example asks which cited papers support a draft paragraph.

Source: [Zotero MCP #213, 2026-04-17](https://github.com/54yyyu/zotero-mcp/issues/213).

Candidate: retrieve supporting or conflicting passages, include surrounding context and personal notes, and provide paper/page links. Retrieval is not a guarantee that a claim is supported; insufficient evidence and interpretation uncertainty remain visible.

## Review-table extraction

A researcher has a spreadsheet of about 500 papers and wants another data column, such as the organism's growth temperature. The assistant should resolve each DOI to the owned full text and extract that field.

Source: [Paperpile request, 2025-12-04](https://forum.paperpile.com/t/feature-request-integration-with-openai-claude-etc/11763/3).

Candidate: populate researcher-defined columns across selected papers with source passages, missing-value markers and reviewable outputs. A spreadsheet-writing integration belongs to the external agent unless LabShelf separately selects an export feature.

## Broader technical-research requests

One researcher using about 2,600 scientific items asks for citation-graph traversal, passage retrieval, reading-queue suggestions based on recent notes, structured annotation export, metadata enrichment, bounded responses, unit-aware numeric extraction and equation/figure/table extraction with captions.

Source: [Zotero MCP roadmap feedback #220, 2026-04-17](https://github.com/54yyyu/zotero-mcp/issues/220).

These are several requests from one researcher, not independent votes. Numeric extraction and citation-graph traversal need dedicated evaluation; they do not justify adding every specialised operation to the default MCP.

## Transfer references between tools

A Paperpile researcher wants the references in a selected document section transferred to NotebookLM or a folder suitable for importing there. Another participant wants citation and similarity relationships visualised for their personal library.

Sources: [reference transfer request, 2026-01-06](https://forum.paperpile.com/t/feature-request-integration-with-openai-claude-etc/11763/5), [citation-graph request, 2026-02-17](https://forum.paperpile.com/t/feature-request-integration-with-openai-claude-etc/11763/18).

These support interoperability needs, not proof that MCP is the required transport or that LabShelf should own an integration with each destination.
