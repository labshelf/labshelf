sha: 2ffdab1d
files: packages/core/src/reader/**, packages/core/src/model/annotation.ts, packages/core/src/library/search/**
source: idea catalogue from this plan's scouts (HCI papers cited inline)

# MCP App ideas — reading and library

Each widget: trigger → what it shows → what the user does in it.

1. **Reader in the chat.** `show_paper(id, page?)` → the core reader with the user's highlights, opened at the page or figure. Selecting text offers Explain, Cite in my project, Highlight; the visible page and selection go to the model through `updateModelContext`. Highlights save to the real sidecar. Fullscreen for real reading.
2. **Paper cards.** `search_papers` → a list of cards with status (Unread / Reading / Done), folder, year, has-PDF, plus Open in LabShelf, Mark as Reading, Cite. Missing papers show Add, which runs the import pipeline.
3. **Import confirmation.** Several DOI matches or a folder that does not exist yet → a picker with the candidates and a folder chooser; the choice is an elicitation answer, not a chat round.
4. **Skim layer** (Scim, https://arxiv.org/pdf/2205.04561). `preread(id)` → the reader with AI marks in three reserved colours: objective, novelty, result; a toggle hides them; one click promotes a mark to a user highlight.
5. **Definitions on hover** (ScholarPhi, https://arxiv.org/pdf/2009.14237). Symbols and acronyms in the reader show the definition found in the same paper, with the page it came from.
6. **Citation map** (CiteSee, https://arxiv.org/pdf/2302.07302). Each reference in the PDF is marked in your library, read by you, or unseen; a graph view ranks the unseen ones by how often your library cites them. Works without AI.
7. **Evidence matrix** (Elicit). `compare(folder, columns)` → a table that fills while the model streams; each cell holds the quote and opens the PDF at its page; Export inserts a `tabular` or Typst `table` into the project.
8. **Reading queue triage.** `triage(project)` → Unread papers ordered by relevance to the project, each with a one-line reason (PaperWeaver, https://arxiv.org/abs/2403.02939); drag to reorder, apply sets status and tags.
9. **Equation walkthrough.** `explain_equation(id, page, box)` → the equation rendered with KaTeX, each symbol clickable for its meaning and where it is defined.
10. **Figure view.** `show_figure(id, n)` → the page region of the figure, rendered from the PDF, with its caption and the passages that cite it.
11. **Highlight quiz.** `quiz(folder)` → flashcards built only from the user's highlights, spaced by recall; wrong answers link back to the page.
12. **Highlights you never used.** `unused_evidence(project)` → highlights in papers the project cites that never reached the manuscript, ranked by how often the user revisited them.
13. **Related-work canvas** (Sensecape, Synergi). Papers clustered by theme on a canvas; the user moves and names clusters; Write paragraph drafts one per cluster as a suggestion.
14. **Library dashboard.** Counts by status and folder, papers without PDF, duplicate candidates, conflict copies; each item is a button that runs the fix.
