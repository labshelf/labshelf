sha: 0b367695
files: packages/core/src/reader/**, packages/core/src/model/annotation.ts, packages/core/src/library/search/**, packages/core/src/ai/**
source: reading idea catalogue; linked user reports; HCI references are research leads

# Explore in-app reading workflows

These are candidates, not accepted scope. [Library access](../../ai-mcp/research/user-needs/library-access.md) and [review workflows](../../ai-mcp/research/user-needs/review-workflows.md) hold the user evidence.

1. **Contextual reading chat.** Ask about the open page or selection alongside the core reader. Explain, Cite and Highlight actions preserve the paper/page context.
2. **Paper results.** Show status (Unread / Reading / Done), folder, year and PDF availability with Open, Mark as Reading and Cite. Missing papers enter confirmed import.
3. **Import confirmation.** Resolve ambiguous identifiers and destination folders through a picker before adding a paper.
4. **Skim layer.** Toggle proposed objective, novelty and result marks; promote an individual mark to a user highlight. Colours use design tokens. Research lead: [Scim](https://arxiv.org/abs/2205.04561).
5. **Definitions on hover.** Explain symbols and acronyms with the defining passage and page in the same paper. Research lead: [ScholarPhi](https://arxiv.org/abs/2009.14237).
6. **Citation map.** Distinguish references present in the library, read or unseen; explore citation links and missing papers. This can be a deterministic feature without AI. Research lead: [CiteSee](https://arxiv.org/abs/2302.07302).
7. **Evidence matrix.** Choose a folder and columns; fill a comparison table with supporting passages and page links. Review before exporting to a manuscript or spreadsheet.
8. **Reading queue triage.** Rank Unread papers against a project with reasons; review ordering, tags and status changes. Research lead: [PaperWeaver](https://arxiv.org/abs/2403.02939).
9. **Equation walkthrough.** Render an equation and inspect each symbol, its definition and assumptions with source locations.
10. **Figure view.** Inspect the actual PDF region, caption and referring passages, rather than infer the image from its caption. Image support depends on the selected model.
11. **Highlight quiz.** Build recall cards from the user's highlights; answers link back to their source pages.
12. **Unused evidence.** Find revisited highlights in cited papers that do not appear in the manuscript.
13. **Related-work canvas.** Cluster papers by theme, rename/move clusters and propose a paragraph per selected cluster. Research leads: Sensecape and Synergi; validation remains open.
14. **Library dashboard.** Surface papers without PDFs, duplicate candidates and conflicts. Counts and navigation do not require a model; changes need review.

Cross-paper synthesis must preserve passage-level provenance and personal notes. Retrieval quality, OCR, formula parsing and unsupported claims need evaluation against real documents; a polished mockup is not evidence of answer quality.

An [external MCP App](../../ai-mcp/research/mcp-apps-experiences.md) may reuse a selected core surface after an external workflow demonstrates a need for it.

