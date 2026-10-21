# Spaces: remaining ideas

Local Spaces in VS Code and the browser follow the [product principles](../product.md#spaces) and [Spaces contract](../contracts/spaces.md). This document holds the capabilities awaiting implementation. Notes, Discussions, Discover, Research chat, sharing, activity and Glossary suggestions have positioned screens with unavailable controls.

The [interactive mockup](spaces-mockup/index.html) explores these ideas with sample data. Build it with `node build.mjs` from that folder, then open `index.html` in a browser. It bundles core UI from this repository. Its in-memory interactions do not describe persistence or collaboration in the apps.

## Research chat and identity

Private Research chat conversations belong to a Space or project. Source selection is explicit: viewing a Space does not imply sending all its contents to a model. Model access and conversation persistence need the [embedded AI plan](../plans/ai-embedded/plan.md).

The identity preview uses [Boring Avatars](https://github.com/hustcc/boring-avatars-vanilla), bundled locally with its license notice. A style selector offers Beam, Pixel and Bauhaus using a faded blue, green, terracotta and yellow core palette with circular avatars. Member icons stay compact; the picker shows larger previews. Generate options creates eight candidates; choosing one updates that member throughout the mockup. The person selector previews each sample member. Choices live only in memory and reset on reload.

## Notes

Notes are rich documents. A note holds text, quotes from papers, images, tables, equations and code. The person writing never needs to know the storage format.

- **The paper note.** Every paper can have one note, opened beside the PDF in the reader. "Add to note" on a selection inserts the passage as a quote with a `labshelf:` link back to its page.
- **Space notes.** Meeting notes, ideas and comparisons that belong to the Space.
- **Checking and reusing mathematics.** [Computational notes](computational-notes.md) capture a paper's equations, check its derivations and carry the results into a manuscript.

Paper notes and highlights are personal by default. "Share in Space" puts a note or a highlight into the Space.

## Discussions

Participants discuss one named topic at a time, linked to a paper, a shared note, a project or the Space itself. A topic keeps its conversation, an editable working summary and an Open / Resolved state. Search covers titles, summaries and message text. Overview surfaces open topics so a question remains visible beyond its latest reply. The private AI panel remains available alongside this shared conversation.

A participant explicitly keeps a message as a decision or creates a task from it. Decisions collect in their own view and link to the original message; summaries are written by participants rather than inferred by AI. Tasks carry an owner and due date, belong to the Space checklist, and appear in both Tasks and Overview. Completing an item in either view updates the same item. Resolving a topic preserves its messages, decisions and tasks, which remain accessible through All topics and the outcome views.

The mockup supports creating topics, replies, summary edits, decisions and assigned tasks in memory. It does not send messages to other people or persist them across reloads. Real sharing, durable history, permissions, notifications and concurrent edits require a storage and collaboration contract before implementation.

## Discover

Discover finds papers from the Space's context, not from the whole web or the whole Library. The data comes from open APIs (OpenAlex, Semantic Scholar, Crossref, arXiv) that each app calls directly, and LabShelf runs no server for it. Those services learn which papers you look up.

- **Feed.** A short ranked list, and each item says why it is there: `cited by 4 papers here, missing`, `cites 3 of this Space's papers`, `your report cites none of its references`, `recent by an author in this Space`. Papers you already have are marked.
- **Gaps.** The works that several of the Space's papers cite and the Space lacks. This is the Library's citation map, restricted to the Space's papers.
- **arXiv alerts per Space.** You choose categories and keywords, and the Space's papers and authors refine them. Alerts come as a daily digest with a cap per Space and a minimum signal, so the feed never floods. Without a server there is no push: the check runs in the background while an app is open, and the browser extension checks on a timer.
- **Watch.** The Space watches its papers for later versions (a preprint that gets published) and for retractions or errata.

A suggestion is triaged with Add to Space, Add to Library or Dismiss. A dismissed item does not come back for that Space.

## Glossary suggestions and reuse

Manual terms, symbols, definitions and sources follow the [Spaces contract](../contracts/spaces.md#glossaryjson). The following capabilities remain ideas:

- Suggest acronyms, definitions and symbols from the Space's papers, using extraction rules and, with [embedded AI](../plans/ai-embedded/plan.md), equation context.
- Show the source passage and require explicit accept, edit or dismiss for every suggestion.
- Underline terms in the reader and show their definitions and sources on hover.
- Complete term macros in LaTeX and Typst, with definitions on hover and generated `labshelf-glossary.tex` or `.typ` files.

PDF text layers split subscripts into separate runs. Symbol matching needs the defining PDF's character sequence and its variants.

## Insert from LabShelf

In any LaTeX, Typst or note file, one panel inserts citations, quotes from highlights, figures, tables and code. Its tabs filter by kind, and a search covers the Space first, then the Library.

- The insert uses the target's own syntax: `\cite`, `\includegraphics` and `tabular` in LaTeX, their Typst forms, and Markdown in a note.
- Every insert carries a one-line provenance comment (`% LabShelf: notes/dropout.qmd#fig-curves`). The document stays a normal LaTeX or Typst file that compiles without LabShelf, and **Reveal source** jumps from the comment back to the PDF page, note cell or code.
- A figure or table is inserted as a copy, as a link that follows its source, or pinned to one version. A pinned or copied item never changes when its source changes. A followed item shows when its source has changed.
- Code links name a file and a symbol, not line numbers. A symbol that does not resolve is reported, never shown silently wrong.

## Sharing

A shared Space uses the relay, keys and invite of [plan `project-collaboration`](../plans/project-collaboration/plan.md); it adds no transport. The Space is one more shared document beside the projects' index documents.

- Linking a project to a shared Space invites the Space's members to that project.
- A paper added by a member always brings its metadata. Its PDF comes when the person adding chooses to share it, which is the default. Each receiver matches the paper against their Library by DOI, arXiv id and title key before importing, so a paper they already have is never duplicated.
- A received paper enters the receiver's Library and is marked with the Space.

## Activity

Since your last visit surfaces the Space's own events: adding papers, editing notes, completing tasks and changing linked projects. Git activity stays outside this feed. Durable events, visit state and member identity need storage and privacy rules before implementation.

## Contracts needed before implementation

- Space membership, paper transfer, permissions and activity history extend the [Spaces contract](../contracts/spaces.md).
- Discussions need durable topics, messages, summaries, decisions and task provenance.
- Notes need a format, a library location and explicit sharing rules.
- Generated Glossary macros need a file contract.
- Passage and highlight links extend the [link grammar](../contracts/links.md).
- Insert from LabShelf needs a provenance format and rules for copied, linked and pinned content.

## Open questions

- **Q1** Is sharing the PDF the default, or does each paper ask?
- **Q2** Does an advisor need a read-only role? The collaboration plan has none: whoever holds the invite edits.
- **Q3** Does a received paper go straight into the Library, or into a place to triage first?
- **Q4** How well do Glossary suggestions work on real PDFs? Running the extraction on five PDFs from the user's field answers it before any UI.
