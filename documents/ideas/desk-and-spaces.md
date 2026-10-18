# Desk and Spaces

LabShelf adds two places beside Library and Projects:

- **Desk**: what is in your hands now. One per user, across every Space.
- **Spaces**: one piece of research work: papers, projects and conversations, and the functions that need to know they belong together. A Space has four tabs: Overview, Notebook, Discover and Glossary.

An interactive mockup lives in [desk-and-spaces-mockup/](desk-and-spaces-mockup/index.html); open `index.html` in a browser. It reads the core tokens from `packages/core`, so it opens only from inside the repository.

Library and Projects stay global. A Space only holds references. It never owns or copies a paper, and removing a paper from a Space never deletes it.

## Desk

The Desk answers "where do I start today?". It combines an inbox, dated commitments and the working set. It is not a calendar: meetings and events stay in the user's calendar app, and the Desk only exports its due dates as `.ics`.

- **In your hands.** The things open right now, for example a PDF at page 6, `method.tex` at line 142 and a Notebook entry. **Resume all** reopens each one where it was left, in any of the three apps. A paper card shows how many open questions its Ledger has, but you answer them on the paper, not on the Desk.
- **Today, This week, Later.** Dated items:
  - reading commitments, which set the paper to Reading with a due date;
  - writing items, which mirror the project's Checklist, so ticking one on the Desk ticks it in the Checklist;
  - project deadlines.

  Each item links to its source, for example "from Lab meeting, 12 Oct".
- **Arrived.** Everything that is still undecided:
  - papers captured by the browser extension;
  - Discover suggestions;
  - items a coauthor shares;
  - watch notices.

  A paper is triaged with Read now, Schedule, Library or Dismiss. A notice that is not a paper offers its own action, such as Compare versions or Show citation. An item that belongs to a Space shows a chip with the Space's name.

Reading status keeps its three values: Unread, Reading and Done.

## Commands

All text surfaces share one command language, parsed in `core`: the Desk bar, the global capture (Cmd/Ctrl+Shift+L, built on the core quick input), Notebook entries, reader notes and comments. Keywords are English only. Dates are in English: `today`, `tomorrow`, weekday names, `25 Oct` and `end of week`.

| Line | Effect |
|---|---|
| `desk: <text>` | Puts an item on the Desk. A line without a command is treated the same way. |
| `read @Paper by <date>` | Adds a reading commitment. |
| `todo <project>: <text> by <date>` | Adds a Checklist item with a due date to that project. |
| `msg <project>: <text>` | Posts to the project's activity, anchored to the `@§x.y` or `@file` the line names. |
| `? <question> @Paper` | Adds a question to the paper's Ledger. |
| `Decided: <text>` | Records a decision. |
| `@Name` | Adds a backlink on the paper, file or section. |

Rules:

- Before saving, every surface shows a preview of what the text will do.
- A command acts once, when the text is saved, and only for its author. A command inside a coauthor's synced text never acts on your machine.
- An unknown paper or project blocks saving and is marked in the preview.

## Space: Overview

The Overview shows what the work owes and what has changed since your last visit.

- **Since last time.** Watch notices for this Space, each with an action.
- **Schedule.** One timeline of the Space's dated commitments: readings, Checklist items and project deadlines. Each entry shows its source entry and whether it is done.
- **The work.** Each project's outline, with what each section still owes: sentences without support, a missing `\cite`, a stale table.
- Short blocks for the latest Notebook entries and the Glossary.

## Space: Notebook

The Notebook is a dated log of meetings and ideas. It is not a general notes app; it exists to tie conversations to papers and drafts.

- Entries are always dated and never rewritten. An idea evolves through later entries that link back to it.
- The command language turns lines into backlinks, decisions, Ledger questions, reading commitments, Checklist items and project messages. A saved entry shows where each line went and whether it is done.
- An entry lists what it mentions and the earlier entries on the same papers.
- An Idea entry offers **Start project from this idea**. It creates a project in the Space whose bibliography already holds the papers the idea mentions.
- **Copy link** gives a link to paste into the chat the lab already uses.

## Space: Discover

Discover is scoped to a Space, so its feed starts from strong signals: the projects' bibliographies, the Space's papers and the drafts' text. There is no global Discover tab.

- **Feed.** A short ranked list, and each item says why it is there: `cites 3 of this Space's papers`, `your references cite it, method.tex does not`, `recent by an author you keep`. Papers you already have are marked.
- **Filters.** All, Gaps (references that several of your papers cite and you do not have), For this draft, New versions.
- **Watch.** The Space watches its papers for new citing papers, new versions (for example a preprint that gets published) and retractions or errata. These notices arrive on the Desk and in Since last time.
- **Search.** One search over the open sources.

The data comes from open APIs that each client calls directly: OpenAlex, Semantic Scholar, Crossref and arXiv. LabShelf runs no server for it. Rate limits mean the feed is built in the background, and offline you see the last one built. Those services learn which papers you look up.

## Space: Glossary

A Space's Glossary holds the terms and symbols you define, for example π<sub>β</sub> as the behaviour policy. It belongs to the Space because the same symbol means different things in different research.

- **Defining a term.** You select an occurrence in a PDF and write its meaning. The entry keeps the notation, the definition, its source passage (paper and page), the variants it matches and a macro name. No LLM or embedding is involved.
- **In the reader.** Matches are underlined in the Space's papers, and hovering one shows the definition and its source.
- **In the editor.** LaTeX and Typst complete glossary terms and show the definition on hover.
- **Generated files.** The project gets a `labshelf-glossary.tex` with one macro per term, generated before each build like `labshelf-values.tex` ([contract](../contracts/library-format.md#labshelf-valuestex)). It also yields a list of symbols.

pdf.js text layers often split subscripts into separate runs, so symbols match less reliably than words. Matching uses the character sequence that the defining PDF produced, plus the variants.

## Papers keep their own questions

Questions about one paper live on that paper, in a **Ledger** tab and in the reader's margin:

- a claim marked as key asks for its evidence (a figure, table or equation, or "none found");
- doubts can be answered or kept open;
- claims link to claims of other papers as confirms, contradicts or depends on.

Answers write the paper's `notes.md`. The Desk and the Space only show how many questions are open.

## Contracts this touches

- The paper metadata gains a due date and a reason for reading commitments.
- `.labshelf/checklist.json` items gain a due date and a link to their source entry ([contract](../contracts/library-format.md#labshelfchecklistjson)).
- New on-disk formats need a contract before they are built: Space, Notebook entry, Ledger, Glossary and the Desk's state.
- Sharing a Space, `msg` and coauthor items use the share mechanism of plan `project-collaboration`.

## Not doing

- **A global Discover tab.** A feed without a Space's scope is generic.
- **A calendar of events.** The user's calendar already does that job.
- **A free lab chat.** Every message is anchored to a project, a section, a file or a paper.
- **An LLM or embeddings in the Glossary.** You define the terms.
- **Discover for papers outside any Space**, for now.
- **Non-English command keywords.**
- **Commands that act from someone else's text.**
- **Spaces above the tabs.** Scoping every tab breaks all of them at once when a coauthor lacks a paper.
- **DOI as the paper id.** Many papers have none, a preprint and its published version have different DOIs, and DOIs contain slashes.

## Open questions

- How reliably can symbols be matched across real PDFs? Testing five PDFs from the user's field answers it.
- Should the Space watch the drafts' text too, for example to warn when a cited paper gets a retraction?
- What does the Desk's synced state look like, so that Resume works across apps?
