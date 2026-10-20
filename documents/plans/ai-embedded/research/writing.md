sha: 0b367695
files: packages/core/src/writing/**, packages/core/src/collab/**
source: writing idea catalogue; linked user reports; HCI references are research leads

# Explore in-app writing workflows

These are candidates, not accepted scope. [Review workflows](../../ai-mcp/research/user-needs/review-workflows.md) and [write-back workflows](../../ai-mcp/research/user-needs/writeback-workflows.md) distinguish user needs from interface proposals.

1. **Suggestion review.** Review a diff per hunk with Accept, Reject and Edit; apply accepted hunks as one request-level undo step. Inline presentation must account for unsaved edits.
2. **Compiled page.** Inspect affected PDF pages and located build problems; Fix attaches the source range and error to the in-app request.
3. **Citation audit.** Compare each claim, cited paper, supporting passage and personal note. Present the model's assessment as reviewable, including insufficient evidence or disagreement with a note.
4. **Citation picker.** Choose a library paper with a supporting passage; LabShelf inserts LaTeX/Typst syntax and writes bibliography entries from library metadata.
5. **Submission checklist.** Check venue rules such as length, anonymity, fonts and references, linking findings to pages or lines. Deterministic checks need no model.
6. **Argument map.** Inspect sections, claims and cited evidence; flag claims without sources.
7. **Rewrite variants.** Compare paragraph variants, select or combine text, then review the resulting suggestion. Research lead: [ABScribe](https://arxiv.org/abs/2310.00117).
8. **Review from the library.** Critique a manuscript using library papers and personal notes, with comments anchored to source ranges.
9. **Rebuttal board.** Anchor reviewer comments, draft responses and related manuscript suggestions. Importing from OpenReview needs its own decision. Research lead: [Defend](https://arxiv.org/abs/2603.27360).
10. **Project dashboard.** Show build state, length, broken references, unused bibliography entries and checklist items. Avoid model calls for deterministic findings.
11. **Activity and undo.** Inspect changes, reasons and request grouping; undo an accepted request across its affected files.
12. **AI-use statement.** Explore disclosure based on accepted-suggestion provenance, distinguishing editing, drafting and code. Do not claim authorship percentages are reliable without a defined tracking model.
13. **Photo to source.** Turn a user-provided equation, table or sketch into LaTeX/Typst as a suggestion, with the original available for checking.
14. **Collaborator view.** Attribute AI comments and suggestions explicitly; shared projects expose anchored changes to collaborators under their access rules.

Writing assistance does not inherently justify an MCP tool: an external agent may already edit local files. The in-app value is contextual review integrated with library sources and existing writing operations. Provider/API/local switching belongs to [provider setup](provider-setup.md).

