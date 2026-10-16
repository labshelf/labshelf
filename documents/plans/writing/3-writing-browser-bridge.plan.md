# Plan: writing from the browser extension

Status: draft
Size: G — browser-only surfaces over core logic that already exists; 4 sessions. Grows to GG if Overleaf blocks the `insertText` path and a DOM integration becomes necessary.
Pending decisions: 1

## 1. Goal

The browser extension becomes the writing companion for people who write in Overleaf or typst.app and read on the web: cite from the LabShelf library inside those editors, keep their bibliography healthy, cite straight from what they are reading, and see at a glance which papers on the web they already own.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md) and [writing-sync.plan.md](2-writing-sync.plan.md).

## 2. Decisions

- [ ] **D1** The library page gets a Writing tab like VS Code's: the projects synced from Drive, each with its PDF in the reader, its reading list, and "Edit" (enabled by [browser-editor](4-browser-editor.plan.md)). Same core component as the VS Code view. — One product.
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
- **Out:** editing projects in the browser ([browser-editor](4-browser-editor.plan.md)); Word and Google Docs (copy a formatted citation only, which exists).
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

## 6. Sessions and steps

### Session 1 — projects in the browser

- **Starts from:** writing-sync done; clean tree.
- **Ends with:** A1
- **Commit:** yes, one per step

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Browser joins the `projects` namespace (IndexedDB adapters, base store) | — | M · implementer (sonnet) | sync fakes pass for the browser | [ ] |
| S2 | Writing tab on the shared component | S1 | M · implementer (sonnet) | A1 | [ ] |
| S3 | Finish, plus a headless `verify` run | S1–S2 | `finish` + `verify` skills | gate passes | [ ] |

### Session 2 — side panel and insertion

- **Starts from:** session 1 committed
- **Ends with:** A2, A3
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S4 | Side panel with library search (Chrome side panel, Firefox sidebar) | — | M · implementer (sonnet) | panel lists papers | [ ] |
| S5 | Editor adapters: `insertText`, clipboard fallback | S4 | H · main thread | A2, A3 on the live sites | [ ] |
| S6 | Finish | S4–S5 | `finish` skill | gate passes | [ ] |

### Session 3 — bibliography

- **Starts from:** session 2 committed
- **Ends with:** A4, A5; Q1 answered
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S7 | Test Overleaf external URL with a Drive link | — | user + H | Q1 answered in §8 | [ ] |
| S8 | `labshelf.bib` link (per Q1) | S7 | M · implementer (sonnet) | A4 | [ ] |
| S9 | Read project sources; health list; import missing by DOI | S5 | H · main thread | A5 | [ ] |
| S10 | Finish | S7–S9 | `finish` skill | gate passes | [ ] |

### Session 4 — reading to writing

- **Starts from:** session 3 committed
- **Ends with:** A6–A9
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S11 | "Cite in project" from the reader and from a page selection | S5 | M · implementer (sonnet) | A6 | [ ] |
| S12 | "You have this paper" on PDFs | — | M · implementer (sonnet) | A7 | [ ] |
| S13 | Library marks on Scholar, arXiv, Semantic Scholar | — | M · implementer (sonnet) | A8 | [ ] |
| S14 | OpenReview reviewer mode | — | M · implementer (sonnet) | A9 | [ ] |
| S15 | Finish, plus a `verify` run | S11–S14 | `finish` + `verify` skills | gate passes | [ ] |

### Step blocks

#### S1 — Projects in IndexedDB

- **Do:** IndexedDB stores for project files and the base store; register the `projects` namespace in the browser's sync run.
- **Context:** the contract is in [sync.md](../../contracts/sync.md) after writing-sync S2.

#### S5 — Editor adapters

- **Do:** per site, detect the focused editor element; insert with `document.execCommand('insertText')` or an `InputEvent`; verify the text landed, else copy and tell the user. The side panel talks to the tab's content script through the background.
- **Context:** content scripts only on `overleaf.com` and `typst.app`, requested as optional host permissions.

#### S9 — Bibliography health

- **Do:** fetch the project's source archive through Overleaf's download endpoint in the user's session (typst.app: its project download); scan citations with the core scanner from writing-core S5; compare with the library; import a missing key through the core resolver chain by DOI.
- **Context:** if the download endpoint changes, the health list shows "unavailable" and logs; insertion still works.

#### S11–S14 — Reading surfaces

- **Do:** a reader-host message "cite in project" carrying key and page; a context-menu entry on page selections; PDF match by DOI or arXiv id in the URL, then title; one adapter per results site with a shared mark component; OpenReview adapter saving into `Reviews/<venue>/` and opening the reader with `review.md` beside it.

## 7. Risks

- **R1** Overleaf or typst.app reject synthetic input. — The clipboard fallback (A3) is part of the design, not an afterthought.
- **R2** Site adapters break. — Each adapter fails closed (no marks) and logs; one adapter per file so a fix is local.
- **R3** A public `.bib` link leaks a reading list. — The panel says it before creating the link; the user can revoke it.

## 8. Log
