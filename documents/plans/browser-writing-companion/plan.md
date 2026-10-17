# Plan: writing from the browser extension

Status: draft
Size: 8 sessions — browser-only surfaces over core logic that already exists. Grows if Overleaf blocks the `insertText` path and a DOM integration becomes necessary.

## 1. Goal

The browser extension becomes the writing companion for people who write in Overleaf or typst.app and read on the web: cite from the LabShelf library inside those editors, keep their bibliography healthy, cite straight from what they are reading, and see at a glance which papers on the web they already own.

Builds on the archived writing-core plan and on plan `folder-sync`: projects are plain folders synced by the user's own tool, and the browser reaches them through the native bridge of plan `folder-sync` (sessions 4–5).

## 2. Decisions

- [ ] **D1** The library page gets a Writing tab like VS Code's: the projects in the library folder and this device's registered external folders, read through the native bridge of plan `folder-sync` (sessions 4–5), each with its PDF in the reader, its reading list, and "Edit" (enabled by the browser-editor plan). Same core component as the VS Code view. — One product.
- [ ] **D2** The Overleaf and typst.app integration lives in the browser's side panel (`chrome.sidePanel`; the sidebar in Firefox), not in their DOM. The panel searches the library and shows bibliography health. — Their page markup changes without notice; our panel does not.
- [ ] **D3** Inserting a citation uses only the standard path: a small content script calls `insertText` on the focused editable element, which CodeMirror treats as typing. If that fails, Enter copies `\cite{key}` (or `@key`) to the clipboard and says so. — No dependency on editor internals; the fallback never breaks.
- [ ] **D5** Bibliography health reads the Overleaf project's sources through Overleaf's own source download in the user's session, and lists: cited keys in the library, cited keys missing (one-click import by DOI), papers with poor metadata. — The panel knows what the project cites without scraping the editor.
- [ ] **D6** Cite from reading: in the LabShelf reader, "Cite in project" on a highlight inserts the citation (with the page) into the active Overleaf or typst.app tab through the same path as D3, or into a project file through the native bridge. A selection on any web page can be sent to a project the same way, as a quote with its reference. — Reading turns into writing in one action.
- [ ] **D7** On a publisher or arXiv PDF that matches a library paper, LabShelf offers "You have this paper, with N highlights — open your copy". — The annotated copy is one click away.
- [ ] **D8** On Google Scholar, arXiv and Semantic Scholar result pages, papers in the library get an "In your library" mark, plus "Cited in <project>" when a project cites them. Each site has one small adapter; a broken adapter fails closed (no marks) and logs. — Discovery that knows what you own.
- [ ] **D9** Reviewer mode on OpenReview: "Review this submission" saves the PDF into a private `Reviews/<venue>` folder, opens it in the reader, and keeps a Markdown review draft with page references beside it. — Reviewing is reading plus writing.
- [ ] **D10** Out of scope: editing projects in the browser (browser-editor plan); Word and Google Docs (copying a formatted citation exists). Contracts touched: `documents/contracts/reader-host.md` ("cite in project" message). — Keeps the plan to the browser.
- [ ] **D11** Packages: the project store over the native bridge in `packages/browser/src/storage/projects/`; Writing tab in `core/src/library-ui/dom/writing/` plus browser glue; side panel in `browser/src/side-panel/`; editor adapters in `browser/src/content/editors/`; site adapters in `browser/src/content/sites/`; paper matching reuses core identifier detection and `titleKey`. Wave-two modules export `handle<Name>(msg, deps): Promise<RuntimeResponse>` and, for page code, `mount<Name>Section(root, deps)`; session 3 wires them. — One placement for all sessions.

Open: none.

## 3. Acceptance

- [ ] **A1** A project synced from VS Code shows in the browser's Writing tab with its PDF.
- [ ] **A2** In an Overleaf editor, picking a paper in the side panel inserts `\cite{key}` at the cursor; the same in typst.app inserts `@key`.
- [ ] **A3** With `insertText` blocked, the panel copies the citation and says so.
- [ ] **A5** The health list names a cited key missing from the library and imports it by DOI in one click.
- [ ] **A6** "Cite in project" on a reader highlight inserts `\cite[p.~4]{key}` into the open Overleaf tab.
- [ ] **A7** Opening an arXiv PDF of a library paper shows the "You have this paper" offer.
- [ ] **A8** A Google Scholar result page marks the library papers.
- [ ] **A9** On an OpenReview submission, "Review this submission" saves the PDF under `Reviews/` and opens the reader with a review draft.

## 4. Sessions

Sessions run in order. A session that changes `package.json`, the lockfile, a tsconfig or a build script runs alone (session 3). Paths in Owns are repository-relative.

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1a | [sessions/1a-projects-store.md](sessions/1a-projects-store.md) | project store API over the native bridge | `packages/browser/src/storage/projects/` | 1b |
| 1b | [sessions/1b-message-seams.md](sessions/1b-message-seams.md) | reader-host `citeInProject` message; runtime message types for the panel, editors and sites | `packages/core/src/reader/protocol.ts`, `packages/core/src/reader/protocol/`, `packages/core/src/reader/host/`, `packages/browser/src/platform/`, `documents/contracts/reader-host.md` | 1a |
| 2a | [sessions/2a-writing-tab.md](sessions/2a-writing-tab.md) | Writing tab on the library page | `packages/core/src/library-ui/dom/writing/`, `packages/browser/src/library-page/` | 2b, 2c |
| 2b | [sessions/2b-panel-insertion.md](sessions/2b-panel-insertion.md) | panel search section, editor adapters, insertion with clipboard fallback | `packages/browser/src/side-panel/search/`, `packages/browser/src/content/editors/`, `packages/browser/src/background/editors/` | 2a, 2c |
| 2c | [sessions/2c-bibliography.md](sessions/2c-bibliography.md) | health section | `packages/browser/src/side-panel/health/`, `packages/browser/src/background/bibliography/` | 2a, 2b |
| 2d | [sessions/2d-cite-from-reading.md](sessions/2d-cite-from-reading.md) | "Cite in project" in the reader and on page selections | `packages/core/src/reader/dom/chrome/`, `packages/browser/src/reader/`, `packages/browser/src/background/citeInProject/` | 2e |
| 2e | [sessions/2e-web-pages.md](sessions/2e-web-pages.md) | "You have this paper", library marks, OpenReview reviewer mode | `packages/browser/src/content/sites/`, `packages/browser/src/content/scholar*.ts`, `packages/browser/src/content/index.ts`, `packages/browser/src/background/pdfOffer/`, `packages/browser/src/background/reviews/` | 2d |
| 3 | [sessions/3-wiring-live.md](sessions/3-wiring-live.md) | composition, manifests, side panel page; headless and live checks A1–A9 | `packages/browser/src/background/router.ts`, `packages/browser/src/background/index.ts`, `packages/browser/src/side-panel/index.html`, `packages/browser/src/side-panel/main.ts`, `packages/browser/build/`, `packages/browser/manifest.chrome.json`, `packages/browser/manifest.firefox.json` | alone |
