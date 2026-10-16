# Plan: writing from the browser extension

Status: draft
Size: G — browser-only surfaces over core logic that already exists; 4 sessions. Grows to GG if Overleaf blocks the `insertText` path and a DOM integration becomes necessary.
Pending decisions: 1

This plan uses the directory format. Read this file, then only `sessions/<n>.md` for your session. `log.md` is append-only: add lines with `>>`, never read it whole.

## 1. Goal

The browser extension becomes the writing companion for people who write in Overleaf or typst.app and read on the web: cite from the LabShelf library inside those editors, keep their bibliography healthy, cite straight from what they are reading, and see at a glance which papers on the web they already own.

Builds on [writing-core](../../archive/writing-core.plan.md) and [writing-sync](../writing-2-writing-sync/plan.md).

## 2. Decisions

- [ ] **D1** The library page gets a Writing tab like VS Code's: the projects synced from Drive, each with its PDF in the reader, its reading list, and "Edit" (enabled by [browser-editor](../writing-4-browser-editor/plan.md)). Same core component as the VS Code view. — One product.
- [ ] **D2** The Overleaf and typst.app integration lives in the browser's side panel (`chrome.sidePanel`; the sidebar in Firefox), not in their DOM. The panel searches the library and shows bibliography health. — Their page markup changes without notice; our panel does not.
- [ ] **D3** Inserting a citation uses only the standard path: a small content script calls `insertText` on the focused editable element, which CodeMirror treats as typing. If that fails, Enter copies `\cite{key}` (or `@key`) to the clipboard and says so. — No dependency on editor internals; the fallback never breaks.
- [ ] **D4** The `.bib` reaches Overleaf without touching its DOM: LabShelf keeps the project's `labshelf.bib` on Drive with an "anyone with the link can read" permission and gives the user that URL for Overleaf's "From external URL" file, which Overleaf refreshes on click. The panel says the file is readable by anyone with the link. — Free-plan Overleaf has no Zotero integration; this fills it.
- [ ] **D5** Bibliography health reads the Overleaf project's sources through Overleaf's own source download in the user's session, and lists: cited keys in the library, cited keys missing (one-click import by DOI), papers with poor metadata. — The panel knows what the project cites without scraping the editor.
- [ ] **D6** Cite from reading: in the LabShelf reader, "Cite in project" on a highlight inserts the citation (with the page) into the active Overleaf or typst.app tab through the same path as D3, or into a project file synced through Drive. A selection on any web page can be sent to a project the same way, as a quote with its reference. — Reading turns into writing in one action.
- [ ] **D7** On a publisher or arXiv PDF that matches a library paper, LabShelf offers "You have this paper, with N highlights — open your copy". — The annotated copy is one click away.
- [ ] **D8** On Google Scholar, arXiv and Semantic Scholar result pages, papers in the library get an "In your library" mark, plus "Cited in <project>" when a project cites them. Each site has one small adapter; a broken adapter hides the marks and logs. — Discovery that knows what you own.
- [ ] **D9** Reviewer mode on OpenReview: "Review this submission" saves the PDF into a private `Reviews/<venue>` folder, opens it in the reader, and keeps a Markdown review draft with page references beside it. — Reviewing is reading plus writing.

Open (blocks approval):

- **Q1** Does Overleaf accept a Google Drive download link as an external URL file? — options: yes, use it / no, serve the `.bib` from a GitHub Gist created by the user; recommendation: test in S7 before building D4 further.

## 3. Scope

- **In:** the browser extension (library page, side panel, content scripts, reader host), the browser's project sync in IndexedDB.
- **Out:** editing projects in the browser ([browser-editor](../writing-4-browser-editor/plan.md)); Word and Google Docs (copy a formatted citation only, which exists).
- **Contracts touched:** [sync.md](../../contracts/sync.md) (the browser joins the `projects` namespace); [reader-host.md](../../contracts/reader-host.md) ("cite in project" message).

## 4. Acceptance criteria

- [ ] **A1** A project synced from VS Code shows in the browser's Writing tab with its PDF.
- [ ] **A2** In an Overleaf editor, picking a paper in the side panel inserts `\cite{key}` at the cursor; the same in typst.app inserts `@key`.
- [ ] **A3** With `insertText` blocked, the panel copies the citation and says so.
- [ ] **A4** The panel shows the `labshelf.bib` URL; added to Overleaf, it compiles with the cited entries.
- [ ] **A5** The health list names a cited key missing from the library and imports it by DOI in one click.
- [ ] **A6** "Cite in project" on a reader highlight inserts `\cite[p.~4]{key}` into the open Overleaf tab.
- [ ] **A7** Opening an arXiv PDF of a library paper shows the "You have this paper" offer.
- [ ] **A8** A Google Scholar result page marks the library papers.
- [ ] **A9** On an OpenReview submission, "Review this submission" saves the PDF under `Reviews/` and opens the reader with a review draft.


## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| projects in IndexedDB, `projects` namespace | `packages/browser/src/storage/`, core sync | same engine and merge as writing-sync |
| Writing tab | `core/src/library-ui/` + browser glue | the component VS Code uses |
| side panel | `packages/browser/src/side-panel/` | search with core search; health list |
| editor adapters | `packages/browser/src/content/editors/` | Overleaf, typst.app: detect the editor, `insertText`, read sources |
| site adapters | `packages/browser/src/content/sites/` | Scholar, arXiv, Semantic Scholar, OpenReview, publisher PDF match |
| paper matching | core identifier detection and `titleKey` | from the refactor |

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | Projects in the browser: IndexedDB stores, Writing tab (A1) | yes, one per step |
| 2 | [sessions/02.md](sessions/02.md) | Side panel and citation insertion (A2, A3) | yes |
| 3 | [sessions/03.md](sessions/03.md) | Bibliography: `labshelf.bib` link and health list (A4, A5; answers Q1) | yes |
| 4 | [sessions/04.md](sessions/04.md) | Reading to writing: cite from the reader, library marks, OpenReview (A6–A9) | yes |

Runner tiers:

- **H**: the session model (Opus or Fable). Use it for design, algorithms and judgment.
- **M**: Sonnet. Use it for well-specified implementation, moves and tests.
- **L**: Haiku. Use it for gates, import fixes and commits.

## 7. Risks

- **R1** Overleaf or typst.app reject synthetic input. — The clipboard fallback (A3) is part of the design, not an afterthought.
- **R2** Site adapters break. — Each adapter fails closed (no marks) and logs; one adapter per file so a fix is local.
- **R3** A public `.bib` link leaks a reading list. — The panel says it before creating the link; the user can revoke it.

## 8. Log

See [log.md](log.md).
