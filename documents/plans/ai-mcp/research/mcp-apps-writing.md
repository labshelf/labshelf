sha: 2ffdab1d
files: packages/core/src/writing/**, packages/core/src/collab/**
source: idea catalogue from this plan's scouts

# MCP App ideas — writing

1. **Suggestion review.** `propose_edit(file, range, text, reason)` → a diff per hunk with Accept, Reject, Edit; accepted hunks apply as one undo step. In VS Code and the browser workspace the same suggestions also appear inline in the editor.
2. **Compiled page.** `build(project)` → the changed pages as images with problem markers from the TeX log at their place; each marker has Fix, which posts "fix this error" with the source line attached.
3. **Citation audit** (claim → evidence). `audit_citations(project, section?)` → a table: sentence, cited paper, supporting passage with page, the user's own highlight and note on that paper, verdict (supported, unsupported, contradicted by your note). Each row opens the PDF or the source line.
4. **Cite picker.** `cite(claim)` → library papers that support the claim, each with the passage; picking one inserts `\cite{key}` or `@key` and writes the entry from `metadata.yaml`. Keys outside the library are rejected.
5. **Submission checklist.** `check(project, venue)` → venue rules as pass/fail rows (pages, anonymity, fonts, references) located at a page or line; Re-run after fixes.
6. **Outline and argument map.** `outline(project)` → sections, the claims in each, and the papers cited for them; sections with claims but no citations stand out.
7. **Variants side by side** (ABScribe, https://arxiv.org/pdf/2310.00117). `rewrite(range, n)` → n versions of a paragraph next to each other; the user picks or mixes; the pick becomes a suggestion.
8. **Reviewer 2 from your reading.** `review(project)` → critique that quotes only papers in the library and points out where the user's notes disagree with the text; each comment anchors to the manuscript.
9. **Rebuttal board** (Defend, https://arxiv.org/pdf/2603.27360). Reviews pasted or pulled from OpenReview → each comment anchored to the manuscript location, a response draft and the manuscript edits it needs, all as suggestions.
10. **Project dashboard.** Build state, word and page count, broken references, unused bib entries, checklist items, papers listed but never cited.
11. **AI activity and undo.** `activity(project)` → what the AI changed, why, and when, with Undo per row and Undo all for one request.
12. **AI-use statement.** `ai_statement(project)` → the share of text that came from accepted AI suggestions, by section and kind (language editing, drafting, code), turned into the disclosure text venues ask for.
13. **Handwriting and photos to source.** The widget takes a photo of an equation, table or sketch (ChatGPT file upload or drag-in) and inserts LaTeX or Typst as a suggestion.
14. **Collaborator view.** In a shared project the AI is one more participant: its cursor and the range it edits show to everyone, and its comments use the anchored-comment format with author "AI".
