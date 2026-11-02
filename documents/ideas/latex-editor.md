# LaTeX and Typst editor: ideas beyond Overleaf

A standard LaTeX editor sees only the manuscript. The LabShelf editor also sees the PDFs the author read, their highlights, notes that compute, where each equation and figure came from, and the readers of other people's papers. Each idea below either uses that position or brings a tool from another field that standard LaTeX editors lack. None is a plan; each needs a prototype before one.

Already shipped or planned, and not repeated here: SyncTeX preview, collaboration, comments, Reviewing mode, citations from the library with their highlights, equations with note origins, figure recipes with stale states, version compare, the Checklist, local builds, drawings that become TikZ ([plan](../plans/drawings/)) and algebra checking in notes ([plan](../plans/math-in-prose/plan.yaml)).

## Citations and the library

- **Citations that show their evidence.** For each `\cite`, the editor finds the passage of the cited PDF that supports the sentence around it. Hovering the citation (in the source or the compiled PDF) shows the passage and page; one click opens the reader there. Each citation shows a state with a glyph and text: supported, related but not stated, not found. A pre-submission list shows the citations not found. The author's highlights weigh as stronger evidence. A first version needs no AI: words and numbers of the sentence searched in the cited paper's text (`writing/checks/pdfFacts.ts`, `writing/citations/quotes.ts`); [embedded AI](../plans/ai-embedded/plan.md) improves the "related" state later. Unlike scite, which classifies citations between published papers, this checks the author's draft against their own library.
- **Missing citations.** While a paragraph is written, the margin lists library papers that discuss the same thing and are not cited there, with the author's highlight in each.
- **Competitor radar.** The editor knows the abstract and the contributions. Each day it compares them with new arXiv papers and reports an overlap ("a preprint from yesterday overlaps your contribution 2"), with their passage beside the author's.
- **Idea genealogy.** Selecting a paragraph shows where it came from: the papers read that week, the highlights made, the note where the idea was tested, the experiment run. Useful for related work and for answering "where does this come from?" in a rebuttal.

## Results that stay true

- **Living numbers.** Every number that comes from a computation (an accuracy, a p-value, a coefficient) links to the note cell that produced it. When the data or the code changes, the number shows as stale on the PDF. "Update results" re-runs and fixes them all as one reviewable suggestion. Extends the note origins and figure recipes that exist.
- **Live tables.** A results table comes from a CSV or a cell output. A visual panel formats it and writes clean `booktabs` LaTeX: the best value of each column in bold and the second underlined (recomputed when numbers change), `mean ± std`, aligned decimals, consistent rounding, sort by column. A re-run experiment marks the table stale, as figures do today.

## Mathematics and notation

- **Notation in the PDF.** Hovering a symbol in the compiled PDF lights all its uses and shows its definition. The editor flags a symbol used before it is defined, one symbol with two meanings, and, when units are declared, a dimensionally inconsistent equation. Builds on the notation table of [computational notes](computational-notes.md#3-notation).
- **Notation refactoring.** Rename by meaning, not by text: the `\alpha` that is the learning rate becomes `\eta`, the significance-level `\alpha` stays. Occurrences are grouped by meaning (structure of the math, the definitions in scope, then context) and the author confirms the groups before anything changes. The change is one suggestion in Reviewing mode. The same map gives unify (two symbols, one meaning), swap (`m` and `n` at once), convention changes (`\vec{x}` → `\mathbf{x}` only for vectors) and promote-to-macro. This is an action of the project glossary ([Spaces ideas](spaces.md#glossary-suggestions-and-reuse)), not a separate store.
- **Equations moved by hand.** Dragging a term of a rendered equation across `=`, factoring two selected terms or multiplying out a denominator writes the next line of the derivation as a clean `align`, each step checked by the CAS of the math-in-prose plan.
- **The argument as a graph.** The editor reads assumptions, definitions, lemmas, theorems and claims, and what supports each (citation, experiment, proof). Weakening an assumption lights everything downstream; "what if H3 is dropped?" shows what falls. Lean Blueprint does this for formalised proofs; this targets ordinary prose and empirical claims.

## Layout

- **Page budget.** The editor says how many lines must go and where the cheapest gains are: paragraphs whose last line holds one or two words (cutting a word gains a line), shrinkable figures, spare vertical space. Each gain shows on the PDF ("−1 line if 4 characters go"). Uses PDF text positions and SyncTeX that exist.
- **Figures resized and placed on the PDF.** See the next section for what is feasible.

### Feasibility of direct figure manipulation

The code edit is deterministic; where LaTeX then places a float is not under the editor's control.

- **Resize works.** A click on a figure finds its `\includegraphics` (SyncTeX gives the figure's lines; the source is parsed there). Dragging a handle scales the image in an overlay at once, without waiting for a build, snapping to common fractions of `\linewidth` or `\columnwidth`. On release one text edit is written (`width=0.6\linewidth`) and the build runs. The same drag always gives the same edit. After the build the float may move to another page when the larger size does not fit; the editor shows where it landed instead of hiding that. Absolute widths (`8cm`), `\resizebox`, `scale=` and subfigure grids each need a rewrite rule; TikZ figures get `\resizebox` or `scale`. Figures built inside the author's own macros are found but not resized.
- **Free placement does not work.** LaTeX places floats by its own algorithm; a figure cannot be put at a y coordinate. Dropping it on a point and waiting for it to land there would need several trial builds and still fail sometimes.
- **Discrete targets work.** Dragging shows a few drop zones: top of this page, bottom of this page, here (`[H]`, after the paragraph under the pointer), next page, own page. Each zone is one deterministic edit: move the `figure` block next to the paragraph under the pointer and set the placement specifier. After the build, a figure that did not land in its zone says so and offers the next option.
- **Responsiveness.** During a drag nothing waits for a build; only the overlay moves. Typst builds fast enough to feel live; LaTeX shows the result seconds later. Each edit is ordinary text, so it works in Reviewing mode and shared projects and undoes in one step.

## Writing and submitting

- **Paragraph alternatives.** Two or three versions of a paragraph or of the abstract's key sentence, shown as tabs over the paragraph; the build uses the chosen one, and coauthors can vote. Replaces blocks commented out with `%`.
- **Venue versions.** One source with layers per destination (8-page conference, extended journal, thesis chapter), shown side by side with each page limit. A fix applies to all; content that exists in one version only is marked, and drift between versions is visible.
- **Listen to the paper.** Read aloud ([idea](read-aloud-and-translation.md)) applied to the author's own PDF: the passage being read is highlighted, mathematics is spoken properly, and a click while listening opens the source there.
- **Anonymity check.** Before a double-blind submission: first-person self-citations ("in our previous work [12]"), acknowledgements, links with the author's GitHub user, author names in the PDF metadata and in embedded images, and paths such as `/Users/<name>/` inside figure PDFs. Fits the Checklist.
- **arXiv package.** One action strips comments, unused files and oversized images, flattens the sources, includes the `.bbl`, and test-builds the way arXiv does. `arxiv_latex_cleaner` covers part of this from the command line.
- **Reader heatmap on the author's own paper.** Readers of the author's preprint who use LabShelf and opt in share anonymous highlights and questions; the author sees where readers highlighted, where they stopped and where they asked. Needs a privacy design and a shared service; it creates a network effect no editor without a reader can copy.

## Talks and posters

Being discussed separately: slides and posters generated from the paper through MCP as HTML and edited in the project. See the presentations idea when written.

## Not pursued

- **WYSIWYG editing on the PDF.** Typing directly on the compiled page is the territory of Mathcha and BaKoMa TeX, costs a great deal, and breaks on unusual packages.

## Not verified

- No web search was done on Overleaf's 2026 features (Writefull, AI Assist) or on other editors; novelty is judged from knowledge.
- How often a word search finds the supporting passage of a citation, and how often occurrences fall in the right meaning group, need prototypes on papers from the user's library.
- Whether `packages/core/src/latex/` already parses math structure was not checked.
