# Plan: links between reading, the library and writing

Status: in progress (session 1 of 1 remaining; source sessions 1–5 are done and logged)
Size: GG — several features across core and the three apps, one of them a new data source (OpenAlex) and one an importer; 6 sessions.
Pending decisions: 0

This plan uses the directory format. Read this file, then only `sessions/01.md`. `log.md` is append-only: add lines with `>>`, never read it whole.

## 1. Goal

What a researcher reads, owns and writes stays connected: code and drafts link to exact pages of papers, highlights become page-precise citations, every paper knows which projects cite it, every project knows what it still has to read, the bibliography warns about stale preprints and duplicates, coauthors get a project's papers in one command, and the library shows which important papers are missing. Zotero users bring their library in one step.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md). AI features are out.

## 2. Decisions

- [x] **D1** A `labshelf:` link format, `labshelf:<citekey>[#p<page>]`, works in any file. VS Code makes it clickable (DocumentLinkProvider) and shows the title on hover; the terminal opens it with `labshelf open <link>`; the browser handles `web+labshelf:` links. — Code that implements a paper points at the exact page.
- [x] **D2** Page-precise citations: citation completion lists the highlights of each paper; picking one inserts `\cite[p.~4]{key}` (Typst `@key[p. 4]`) and can paste the quote. — A highlight is already a citation waiting to happen.
- [x] **D3** Backlinks: the paper detail pane shows "Cited in <project> (§3)" from the citation scan of every project. — A paper's role in your work is visible where you manage it.
- [x] **D4** Project reading list: each project has its papers (cited plus added by hand) with reading status, and a warning "You cite 4 papers you never opened". — Writing shows what reading is left.
- [x] **D5** Continue where you left off: the library home shows the last paper and page read and the last project file edited, from any app, through the synced sidecar and a per-project `.labshelf/state.json`. — Moving between apps loses nothing.
- [x] **D6** Bibliography linter in VS Code: duplicate entries (same DOI or title key), missing DOI, and preprints that have a published version (found by the published-version lookup `publishedDoiOf` in `core/src/import/registries/publishedDoi.ts`), with a quick fix that replaces the entry. — Every submission hits these.
- [x] **D7** Papers as dependencies: `labshelf.yaml` lists the project's papers (`papers:` with key and DOI), kept in sync with the citations. `labshelf install` (VS Code command and terminal) fetches the missing ones into the coauthor's library through the core resolver chain, using the coauthor's own access. — Onboarding a coauthor is one command.
- [x] **D8** Citation map from OpenAlex (open data, no key): for each library paper with a DOI, its references and citing works; the library view "Often cited by your papers, not in your library" with one-click import, and a graph view in VS Code and the browser. Cached in `.research/openalex/`, never synced. — Discovery without AI.
- [x] **D9** Zotero import: read `zotero.sqlite` (copied first, never opened in place) and its `storage/` folder; collections become folders, items become papers with PDFs, notes go to `note`, tags to `tags`; annotations from Zotero's reader become sidecar highlights where the position maps. — The main door for the audience.

- [x] **Q1** The reading list holds the cited papers plus papers added by hand; papers opened while the project is active are not added, because automatic membership gets noisy.

## 3. Scope

- **In:** core (link format, highlight-to-citation, backlink index, linter rules, OpenAlex citation data in the existing client, Zotero reader), VS Code, terminal (`open`, `install`), browser (links, backlinks, map view).
- **Out:** AI suggestions; Mendeley and EndNote import.
- **Contracts touched:** [library-format.md](../../contracts/library-format.md) (`papers:` in `labshelf.yaml`, `.labshelf/state.json`, `.research/openalex/`).

## 4. Acceptance criteria

- [x] **A1** `// see labshelf:vaswani2017#p5` in a `.py` file is a link; clicking opens the reader at page 5; `labshelf open labshelf:vaswani2017#p5` does the same from the terminal.
- [x] **A2** Typing `\cite[` on a paper with highlights lists them; picking one inserts `\cite[p.~4]{key}`.
- [ ] **A3** A paper cited by a project shows "Cited in <project>" in VS Code and the browser. (Verified in VS Code; the browser has no writing projects until writing-sync brings them, then its host fills `citedIn`.)
- [x] **A4** The project's reading list shows its papers with status and the never-opened warning.
- [x] **A5** After reading in the browser, VS Code's library home offers "Continue: <paper>, page 6".
- [x] **A6** A bib with an arXiv entry whose paper was published gets a linter warning and a quick fix with the published entry.
- [x] **A7** On a second machine, `labshelf install` in a cloned project adds the missing papers to the library.
- [ ] **A8** The "often cited, missing" list shows papers cited by at least 3 library papers and imports one in a click. (Built and checked in a browser harness with a synthetic map; no run against live OpenAlex on a real library, and the VS Code extension host run was cut short.)
- [ ] **A9** Importing a Zotero library recreates its collections, PDFs, tags and notes.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| link parse and format | `core/src/library/links/` | `labshelf:<key>[#p<n>]` |
| highlight-to-citation | `core/src/writing/citations/` | uses the sidecar annotations |
| backlink index, reading list | `core/src/writing/` | built from the project citation scans |
| linter rules | `core/src/writing/bibLint/` | preprint check calls `publishedDoiOf`, never a second copy of it; `titleKey` for duplicates |
| OpenAlex works by DOI, cache, map | `core/src/import/registries/works/openalex.ts`; cache and map in `core/src/import/citationMap/` | extends the existing client and its `RegistryEnv`; the cache runs over `IFileSystem`, so every app can use it |
| Zotero reader | `core/src/import/zotero/node/` | `node:sqlite` on a copy of `zotero.sqlite` |
| UI | each app | providers and commands in VS Code; detail sections in the shared library UI |

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | Zotero import (A9) | yes |

Runner tiers:

- **H**: the session model (Opus or Fable). Use it for design, algorithms and judgment.
- **M**: Sonnet. Use it for well-specified implementation, moves and tests.
- **L**: Haiku. Use it for gates, import fixes and commits.

Links, highlights, backlinks, reading list, continue, linter, dependencies and citation map (S1–S16) are done; see [log.md](log.md).

## 7. Risks

- **R1** Crossref and OpenAlex miss the preprint relation. — The linter only warns when a relation exists; no guessing by title alone.
- **R2** Zotero's schema changes between versions. — Read through a version check; fixture per supported schema.

## 8. Log

See [log.md](log.md).
