# Spaces

A Space gathers one piece of work: the papers it uses, its writing projects, its notes, its checklist and dates, and the people who share it. This is an idea, not approved scope.

An interactive mockup lives in [spaces-mockup/](spaces-mockup/index.html). Build it with `node build.mjs` from that folder, then open `index.html` in a browser. It bundles the core sidebar, tokens and icons from `packages/core`, so it works only from inside the repository.

## Browsing Spaces and research chat

All Spaces opens an editor tab from the Spaces sidebar. Search and Personal / Shared filters narrow the list. Each row brings together reading progress, links to papers and notes, the project count, the next unfinished task and members. Opening a Space keeps this catalog available in its own tab.

Research chat opens in a collapsible right panel beside the active editor. Conversations belong to a Space or project and stay private to the user. The panel names the active context and offers explicit source selection; viewing a Space does not imply sending all its contents to a model. The mockup previews conversations without contacting a model or executing tools.

The identity preview uses [Boring Avatars](https://github.com/hustcc/boring-avatars-vanilla), bundled locally with its license notice. A style selector offers Beam, Pixel and Bauhaus using a faded blue, green, terracotta and yellow core palette with circular avatars. Member icons stay compact; the picker shows larger previews. Generate options creates eight candidates; choosing one updates that member throughout the mockup. The person selector previews each sample member. Choices live only in memory and reset on reload.

## Why a Space

A student with three pieces of work (a course assignment, a research internship, a personal project) needs papers X, Y and Z for the internship and H, Y, Z and J for the course. A Library folder is physical, so Y and Z cannot sit in both without copies. A group that works together also rebuilds the same organisation of papers, tasks and dates on every member's machine.

A Space solves both:

- **References, not copies.** A Space holds paper ids. Y and Z show up in both Spaces and exist once on disk. Removing a paper from a Space never deletes it from the Library. Leaving a Space keeps the papers you received.
- **One shared context.** Sharing a Space shares its papers, its own folders, its notes, its checklist, its dates and which projects belong to it. An advisor adds papers and sees which projects to read. A course group edits the report together and sees what is due.

Library and Projects stay global and work without any Space. Nobody has to create a Space to manage papers or write LaTeX.

## In the sidebar

Spaces is a third section after Library and Projects, with the same tree rows. Each Space row opens the Space in an editor tab. Its children are the Space's own folders, which organise references only.

## Tabs

A Space opens on **Overview**. The other tabs are **Papers**, **Notes**, **Discussions**, **Discover** and **Glossary**.

### Overview

Overview answers "what is happening and what is due". It holds:

- **Dates and goals.** The Space's deadlines and its checklist items with due dates, on one timeline. A goal is something LabShelf can check by itself, such as "read these 5 papers by 3 Nov" or "first draft of the report by 10 Nov". Reading status and project state supply its progress. Dates export as `.ics`, and there is no calendar.
- **Since your last visit.** Activity recorded by the Space itself: who added a paper, edited a note, ticked an item, or changed a linked project. Git events stay outside the Space.
- **Projects.** Each linked project with its format, main file, deadline and checklist progress. Opening one opens the normal project.
- **Papers in focus.** The papers the Space marks as current, with their status (Unread, Reading, Done).
- **Members.** Who shares the Space, plus Share.

Every block shows its empty state in a personal Space that has only a name and two papers. A Space with no dates shows no timeline.

### Papers

The Space's papers in its own folders. A paper row is the Library paper itself: the same title, status and detail pane. A row shows who added the paper when the Space is shared. A paper that a member added and whose PDF was not shared shows its metadata and an action to find the PDF.

### Notes

Notes are rich documents. A note holds text, quotes from papers, images, tables, equations and code. The person writing never needs to know the storage format.

- **The paper note.** Every paper can have one note, opened beside the PDF in the reader. "Add to note" on a selection inserts the passage as a quote with a `labshelf:` link back to its page.
- **Space notes.** Meeting notes, ideas and comparisons that belong to the Space.
- **Editing and calculations.** [Computational notes](computational-notes.md) defines the `.qmd` editing experience, live rendering, automatic cell execution, local engines and export boundaries.

Paper notes and highlights are personal by default. "Share in Space" puts a note or a highlight into the Space.

### Discussions

Participants discuss one named topic at a time, linked to a paper, a shared note, a project or the Space itself. A topic keeps its conversation, an editable working summary and an Open / Resolved state. Search covers titles, summaries and message text. Overview surfaces open topics so a question remains visible beyond its latest reply. The private AI panel remains available alongside this shared conversation.

A participant explicitly keeps a message as a decision or creates a task from it. Decisions collect in their own view and link to the original message; summaries are written by participants rather than inferred by AI. Tasks carry an owner and due date, belong to the Space checklist, and appear in both Tasks and Overview. Completing an item in either view updates the same item. Resolving a topic preserves its messages, decisions and tasks, which remain accessible through All topics and the outcome views.

The mockup supports creating topics, replies, summary edits, decisions and assigned tasks in memory. It does not send messages to other people or persist them across reloads. Real sharing, durable history, permissions, notifications and concurrent edits require a storage and collaboration contract before implementation.

### Discover

Discover finds papers from the Space's context, not from the whole web or the whole Library. The data comes from open APIs (OpenAlex, Semantic Scholar, Crossref, arXiv) that each app calls directly, and LabShelf runs no server for it. Those services learn which papers you look up.

- **Feed.** A short ranked list, and each item says why it is there: `cited by 4 papers here, missing`, `cites 3 of this Space's papers`, `your report cites none of its references`, `recent by an author in this Space`. Papers you already have are marked.
- **Gaps.** The works that several of the Space's papers cite and the Space lacks. This is the Library's citation map, restricted to the Space's papers.
- **arXiv alerts per Space.** You choose categories and keywords, and the Space's papers and authors refine them. Alerts come as a daily digest with a cap per Space and a minimum signal, so the feed never floods. Without a server there is no push: the check runs in the background while an app is open, and the browser extension checks on a timer.
- **Watch.** The Space watches its papers for later versions (a preprint that gets published) and for retractions or errata.

A suggestion is triaged with Add to Space, Add to Library or Dismiss. A dismissed item does not come back for that Space.

### Glossary

The Glossary holds the terms and symbols of the Space. It belongs to the Space because the same symbol means different things in different research.

- **Starts partly filled.** LabShelf suggests entries from the Space's papers: acronyms by rule (the Schwartz–Hearst algorithm), definitions from patterns such as "we define … as" and "where … denotes", and, when embedded AI is set up ([plan](../plans/ai-embedded/plan.md)), symbol definitions from equations.
- **Every suggestion is reviewed.** A suggestion shows its source passage (paper and page), and you accept, edit or dismiss it. Nothing enters the Glossary silently, because a wrong definition is worse than none.
- **Conflicts are shown.** When two papers of the Space use one symbol for two things, the entry shows both meanings with their sources.
- **In the reader.** Terms are underlined in the Space's papers, and hovering one shows its definition and source.
- **In the editor.** Each term has a macro. LaTeX and Typst complete it and show its definition on hover. The project gets a generated `labshelf-glossary.tex` (or `.typ`) with one macro per term and a list of symbols.

TRAP: pdf.js text layers often split subscripts into separate runs, so symbols match less reliably than words. Matching uses the character sequence the defining PDF produced, plus the variants.

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

## Contracts this touches

Each format needs a contract in `documents/contracts/` before it is built:

- the Space file: members, paper ids, folders, linked projects, checklist, dates and goals;
- participant topics, message history, summaries, explicit decisions and task provenance;
- the note format and where notes live in the library;
- the Glossary and its generated macro files;
- the `labshelf:` link grammar, extended to a passage or highlight ([contract](../contracts/links.md));
- the provenance comment of Insert from LabShelf.

## Not doing

- **A Desk or inbox across Spaces.** Overview and Discover cover what is due and what arrived.
- **A command language in notes.** Checklist items and dates are set with controls.
- **A global Discover tab.** A feed without a Space's scope is generic.
- **A calendar of events.** The user's calendar already does that job.
- **A single chronological group feed.** Participant conversations belong to named topics; decisions and follow-ups have dedicated views.
- **Git activity in the Space.** The Space records only its own events.
- **A `.ls` format.** `.qmd`, `.md` and documented side files cover the need.
- **Running code on open.** Opening or receiving a note does not enable its calculations; the execution behavior is defined in [Computational notes](computational-notes.md#live-rendering-and-computation).
- **DOI as the paper id.** Many papers have none, a preprint and its published version have different DOIs, and DOIs contain slashes.

## Open questions

- **Q1** Is sharing the PDF the default, or does each paper ask?
- **Q2** Does an advisor need a read-only role? The collaboration plan has none: whoever holds the invite edits.
- **Q3** Does a received paper go straight into the Library, or into a place to triage first?
- **Q4** How well do Glossary suggestions work on real PDFs? Running the extraction on five PDFs from the user's field answers it before any UI.
- **Q5** Is "Space" the name? It must not be "Workspace" (VS Code's) or "Project" (taken).
