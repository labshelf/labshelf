# Plan: Notes in Quarto Markdown everywhere

Status: in progress
Size: 14 sessions — a new on-disk format, a block merge, a rich editor and three surfaces (reader, projects, Spaces) before computation and the manuscript link

## 1. Goal

Every place a user writes outside LaTeX or Typst (paper notes, text boxes on a PDF page, project notes, comments and review suggestions, Space notes and discussions) is Quarto Markdown underneath, edited in one rich editor that never shows the syntax. One `.qmd` file holds every item of one case (all notes of a paper, one discussion thread), and LabShelf shows the items one by one. Notes carry math, code cells with their results, and links back to papers; they feed the project checklist and the manuscript, and code cells run in an optional Python that the user chooses to install through the helper.

## 2. Decisions

- [x] **D1** The format is "LabShelf Markdown": a defined subset of Quarto Markdown, specified in a new contract `documents/contracts/qmd-items.md`. Code lives in a new core domain `packages/core/src/qmd/` (runtime-neutral root, `dom/` for the editor). — One format, one parser, one editor for every writing field.
- [x] **D2** One file per case. Each item is a fenced div `::: {#<id> .labshelf-item anchor="…" author="…" created="…"}` … `:::`. Ids are `n-` + ULID (time-sortable, created without coordination). An anchor is `hl:<annotation id>`, `p<page> box <x> <y> <w> <h>`, `quote:<base64url JSON of quote, prefix and suffix>`, or absent. Text outside any item is kept and shown as an item without anchor; nothing a user wrote is ever dropped. — Few files, readable in Quarto, safe against hand edits.
- [x] **D3** A cell result is stored inside the file, right after its cell, as `::: {.labshelf-output cell="<label>" source="<first 12 hex characters of the SHA-256 of the cell code without its #| lines>" engine="…" ran="…"}`. A result whose `source` does not match the cell code shows as out of date. — A note or a message carries its results; the receiver sees them without running anything.
- [x] **D4** `.qmd` item files merge by block: three-way against the existing per-device base, keyed by item id (union of new items, one-sided edits kept, deletes honoured, edit beats delete, both-sided edits merged as text inside the item). Applies in projects, paper folders and Space folders. — Line merge turns two appends into conflict markers.
- [x] **D5** Rich editor on ProseMirror (new dependency), in `packages/core/src/qmd/dom/editor/`. Conversion `.qmd` ↔ ProseMirror document lives in `packages/core/src/qmd/prosemirror/` and round-trips byte for byte on files LabShelf wrote. Math renders through the existing `@labshelf/core/math` (MathJax SVG), loaded lazily. — The user asked for an editor that never shows syntax.
- [x] **D6** Paper notes live in `.research/papers/<id>/notes.qmd`. The paper record's `note` field and the `content` of `type: "note"` annotations move into it through a migration in `packages/core/src/qmd/migrations/`; highlight geometry stays in `data.json`, and a note on a highlight anchors to the annotation id. — One home for what a user writes about a paper.
- [x] **D7** A text box on a PDF page is a paper-note item with anchor `p<page> box <x> <y> <w> <h>` in page fractions (as highlights), drawn over the page, always visible, never changing the PDF; long content is clipped and expands on click. — The macOS Preview behaviour the user asked for.
- [x] **D8** Project comments, review comments and suggestions become items in `.labshelf/comments.qmd` (anchor = the existing quote/prefix/suffix anchor). One item per comment: the first item of a thread carries its anchor, file and resolved state; replies carry `thread=<first item id>`. `comments.json` is read once by a migration and deleted. — Same paradigm; comment bodies get math and code.
- [x] **D9** The project checklist and problems are views derived from project `.qmd` files: a task-list item `- [ ]` in a project note is a checklist item, ticking it in either place edits the note. — One source of truth, no copies.
- [x] **D10** "Send to…" on any selection (PDF passage, figure crop, equation, item) appends an item with a `labshelf:` back-link to a chosen `.qmd` target (project note, project checklist note, Space note or discussion), remembering recent targets. — Capture without leaving the reader.
- [x] **D11** Python + SymPy is a managed tool under `<shared root>/python/`, pinned by version and SHA-256 like TeX (`documents/contracts/managed-tools.md`). Cells run through a core port `ICellRunner`; the helper adds `runCell`/`cancelCell` messages for the browser, VS Code runs the same core node runner directly. Cancel kills the process. No Pyodide, nothing bundled in the extension. — The user chooses what to install.
- [x] **D12** An equation inserted into a manuscript ends with `% labshelf: <note path>#<eq label> @<hash of inserted LaTeX>`. The editor compares hashes: manuscript changed → diverged (never overwritten), note changed → stale (one-click update). Figures and numbers from notes reuse the existing `figures:` and `values:` of `labshelf.yaml`. — Stateless provenance that survives sync and git.
- [x] **D13** Terminal: notes open as `.qmd` text in `$EDITOR`, `labshelf show` prints them; no rich editor, no cells. Equation capture from PDFs, AI, notation tables and "check this step" stay in `documents/ideas/computational-notes.md` for a later plan.

Answered (recommendations accepted 2026-10-22):

- **Q1** → a. Live collaboration of a `.qmd` file — a) the shared doc holds a `Y.XmlFragment` bound with y-prosemirror, and the disk mirror serializes it to `.qmd` / b) keep `Y.Text` per file as today and translate text diffs to editor transactions; recommendation: a, because y-prosemirror is the maintained binding and b is a hand-written diff bridge that loses cursor intent. It changes `documents/contracts/collaboration.md` for `.qmd` docs only.
- **Q2** → a. How Python gets installed — a) on demand from the app (Run → "Install Python for calculations", as TeX today) plus a checkbox in the helper installers that runs the same install / b) installer only; recommendation: a, because the installers have no component pages today and a user who skipped it can still add it later.
- **Q3** → "note". Product name for an item in the UI — "note" / another word; recommendation: "note" until the user picks one, kept in one vocabulary file so a rename is one change.
- **Q4** → format and local UI now. Space discussions — Space sharing does not exist yet; recommendation: build the format and the local UI now, sharing comes with a Space-sharing plan.
- **Q5** → keep that condition. When the migrations of D6 and D8 are deleted — their headers say: when `library-format.md` stops listing the old key or file as readable, which needs a library format version bump; recommendation: keep that condition.

## 3. Acceptance

- [x] **A1** `qmd-items` contract tests: parse → serialize is byte-identical on fixtures; text outside items survives; unknown attributes survive; a malformed fence never loses text.
- [x] **A2** Two devices each add a note to the same `notes.qmd` offline; after sync both notes are there, no conflict markers. A note deleted on one device and untouched on the other stays deleted; deleted on one and edited on the other stays, edited.
- [ ] **A3** In VS Code and in the browser, a note shows headings, lists, task lists, rendered display and inline math, a code cell and its result, with no Markdown syntax visible; Source mode shows the `.qmd`.
- [ ] **A4** After upgrading, a paper's old note text and its old note annotations appear as items in `notes.qmd`, and `metadata.yaml` has no `note` key; the terminal shows the same notes.
- [ ] **A5** In the reader, the text-box tool draws a box in an empty area of page 10; it shows its rendered content on the page at any zoom, and opening the paper on another device shows it in the same place.
- [ ] **A6** Selecting a passage in the reader and choosing Send to → project "modern-thesis" adds an item with a link back to the page to that project's note; a `- [ ]` in it appears in the project Checklist, and ticking it there ticks it in the note.
- [ ] **A7** Comments and review comments of a project appear as before after migration, now with math; `comments.json` is gone.
- [ ] **A8** A Space has Notes and Discussions tabs backed by one `.qmd` per note or thread.
- [ ] **A9** Without Python installed, Run explains what to install; after installing from the app, a SymPy cell runs from VS Code and from the browser through the helper, its result is written into the note, a stuck cell is cancelled, and editing the cell marks the result out of date.
- [ ] **A10** Inserting an equation from a note writes the origin comment; editing the note marks it stale with an update action; editing the manuscript marks it diverged and nothing is overwritten.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1.md](sessions/1.md) | `qmd-items` contract, parser, serializer | `documents/contracts/qmd-items.md`, `packages/core/src/qmd/` (root, `items/`, `ids/`) | alone |
| 2 | [sessions/2.md](sessions/2.md) | Block merge and sync of `.qmd` | `packages/core/src/qmd/merge/`, `packages/core/src/writing/merge/`, `packages/core/src/library/conflicts/node/`, `documents/contracts/sync.md`, conflict sections of `library-format.md` and `spaces.md` | 3 |
| 3 | [sessions/3.md](sessions/3.md) | ProseMirror schema and `.qmd` ↔ document conversion | `packages/core/src/qmd/prosemirror/`, `packages/core/package.json`, lockfile | alone (dependency) |
| 4 | [sessions/4.md](sessions/4.md) | Rich editor component | `packages/core/src/qmd/dom/` | alone |
| 5 | [sessions/5.md](sessions/5.md) | Editor in VS Code webviews and browser pages | `packages/vscode/build/`, `packages/browser/build/`, webview HTML/CSP files | alone |
| 6 | [sessions/6.md](sessions/6.md) | Paper `notes.qmd`, migration of `note` | `packages/core/src/qmd/migrations/`, `packages/core/src/qmd/paperNotes/`, `note` users in all packages | alone |
| 7 | [sessions/7.md](sessions/7.md) | Reader notes panel and text boxes on pages | `packages/core/src/reader/{dom,protocol,host,geometry}/`, `documents/contracts/reader-host.md` | 8 |
| 8 | [sessions/8.md](sessions/8.md) | Comments as `.qmd` items | `packages/core/src/collab/{comments,mirror}/`, `packages/core/src/qmd/collab/`, `documents/contracts/collaboration.md`, comment UI in vscode and browser | 7 |
| 9 | [sessions/9.md](sessions/9.md) | Project notes, derived checklist, Send to, notes where a paper is cited | `packages/core/src/writing/checklist/`, `packages/core/src/qmd/sendTo/`, project UI | alone |
| 10 | [sessions/10.md](sessions/10.md) | Space Notes and Discussions | `packages/core/src/spaces/` | 11 |
| 11 | [sessions/11.md](sessions/11.md) | Managed Python | `packages/core/src/qmd/compute/node/managed/`, `documents/contracts/managed-tools.md`, installers | 10 |
| 12 | [sessions/12.md](sessions/12.md) | Running cells (port, helper, VS Code) | `packages/core/src/qmd/compute/`, helper handlers, browser helper client | alone |
| 13 | [sessions/13.md](sessions/13.md) | Equations, figures and values from notes into the manuscript | `packages/core/src/writing/noteLinks/`, editor glue in vscode and browser | alone |
| 14 | [sessions/14.md](sessions/14.md) | Finish: docs, dead code, review | `documents/`, whatever `finish` touches | alone |
