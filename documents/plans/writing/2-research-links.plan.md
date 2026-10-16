# Plan: links between reading, the library and writing

Status: in progress (session 3 of 6)
Size: GG — several features across core and the three apps, one of them a new data source (OpenAlex) and one an importer; 6 sessions.

## 1. Goal

What a researcher reads, owns and writes stays connected: code and drafts link to exact pages of papers, highlights become page-precise citations, every paper knows which projects cite it, every project knows what it still has to read, the bibliography warns about stale preprints and duplicates, coauthors get a project's papers in one command, and the library shows which important papers are missing. Zotero users bring their library in one step.

Builds on [writing-core.plan.md](../../archive/writing-core.plan.md). AI features are out.

## 2. Decisions

- [x] **D1** A `labshelf:` link format, `labshelf:<citekey>[#p<page>]`, works in any file. VS Code makes it clickable (DocumentLinkProvider) and shows the title on hover; the terminal opens it with `labshelf open <link>`; the browser handles `web+labshelf:` links. — Code that implements a paper points at the exact page.
- [x] **D2** Page-precise citations: citation completion lists the highlights of each paper; picking one inserts `\cite[p.~4]{key}` (Typst `@key[p. 4]`) and can paste the quote. — A highlight is already a citation waiting to happen.
- [x] **D3** Backlinks: the paper detail pane shows "Cited in <project> (§3)" from the citation scan of every project. — A paper's role in your work is visible where you manage it.
- [x] **D4** Project reading list: each project has its papers (cited plus added by hand) with reading status, and a warning "You cite 4 papers you never opened". — Writing shows what reading is left.
- [x] **D5** Continue where you left off: the library home shows the last paper and page read and the last project file edited, from any app, through the synced sidecar and a per-project `.labshelf/state.json`. — Moving between apps loses nothing.
- [x] **D6** Bibliography linter in VS Code: duplicate entries (same DOI or title key), missing DOI, and preprints that have a published version (found by the published-version lookup that [pdf-finding](../pdf-finding.plan.md) builds in its S21; its path is in that plan's §8 log, see its C2), with a quick fix that replaces the entry. — Every submission hits these.
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
- [ ] **A3** A paper cited by a project shows "Cited in <project>" in VS Code and the browser.
- [x] **A4** The project's reading list shows its papers with status and the never-opened warning.
- [x] **A5** After reading in the browser, VS Code's library home offers "Continue: <paper>, page 6".
- [x] **A6** A bib with an arXiv entry whose paper was published gets a linter warning and a quick fix with the published entry.
- [ ] **A7** On a second machine, `labshelf install` in a cloned project adds the missing papers to the library.
- [ ] **A8** The "often cited, missing" list shows papers cited by at least 3 library papers and imports one in a click.
- [ ] **A9** Importing a Zotero library recreates its collections, PDFs, tags and notes.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| link parse and format | `core/src/library/links/` | `labshelf:<key>[#p<n>]` |
| highlight-to-citation | `core/src/writing/citations/` | uses the sidecar annotations |
| backlink index, reading list | `core/src/writing/` | built from the project citation scans |
| linter rules | `core/src/writing/bibLint/` | preprint check calls pdf-finding's published-version lookup, never a second copy of it; `titleKey` for duplicates |
| OpenAlex works by DOI and cache | `core/src/import/registries/works/openalex.ts`, cache in a `node/` folder beside it | extends the existing client and its `RegistryEnv`, which already carries the contact email for the polite pool |
| Zotero reader | `core/src/import/zotero/node/` | `node:sqlite` on a copy of `zotero.sqlite` |
| UI | each app | providers and commands in VS Code; detail sections in the shared library UI |

## 6. Sessions and steps

### Session 1 — links

- **Starts from:** writing-core done; clean tree.
- **Ends with:** A1
- **Commit:** yes, one per step

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Link format; VS Code link provider and URI handler; terminal `open`; browser protocol handler | — | M · implementer (sonnet) | A1 | [x] |
| S2 | Finish | S1 | `finish` skill | gate passes | [x] |

### Session 2 — highlights, backlinks, reading list, continue

- **Starts from:** session 1 committed
- **Ends with:** A2–A5
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S3 | Highlight-to-citation in completion | — | M · implementer (sonnet) | A2 | [x] |
| S4 | Backlink index and detail section | — | H · main thread | A3 | [x] |
| S5 | Reading list view and warning | S4 | M · implementer (sonnet) | A4 | [x] |
| S6 | Continue where you left off | — | M · implementer (sonnet) | A5 | [x] |
| S7 | Finish | S3–S6 | `finish` skill | gate passes | [x] |

### Session 3 — bibliography linter

- **Starts from:** session 2 committed
- **Ends with:** A6
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S8 | Lint rules, with pdf-finding's published-version lookup | pdf-finding S21 merged | H · main thread | core tests with recorded responses | [x] |
| S9 | Diagnostics and quick fixes in VS Code | S8 | M · implementer (sonnet) | A6 | [x] |
| S10 | Finish | S8–S9 | `finish` skill | gate passes | [x] |

### Session 4 — papers as dependencies

- **Starts from:** session 3 committed
- **Ends with:** A7
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S11 | `papers:` kept in sync with citations | — | M · implementer (sonnet) | core tests | [ ] |
| S12 | `install` in core; VS Code command; terminal command | S11 | M · implementer (sonnet) | A7 | [ ] |
| S13 | Finish | S11–S12 | `finish` skill | gate passes | [ ] |

### Session 5 — citation map

- **Starts from:** session 4 committed
- **Ends with:** A8
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S14 | OpenAlex client, cache and the "often cited, missing" query | — | H · main thread | core tests with recorded responses | [ ] |
| S15 | List view in VS Code and browser; graph view | S14 | M · implementer (sonnet) | A8 | [ ] |
| S16 | Finish | S14–S15 | `finish` skill | gate passes | [ ] |

### Session 6 — Zotero import

- **Starts from:** session 5 committed
- **Ends with:** A9
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S17 | Zotero reader and mapping to the library format | — | H · main thread | core tests on a fixture Zotero database | [ ] |
| S18 | Import command in VS Code and the terminal | S17 | M · implementer (sonnet) | A9 | [ ] |
| S19 | Finish | S17–S18 | `finish` skill | gate passes | [ ] |

### Step blocks

#### S1 — Links

- **Do:** parse and format `labshelf:<key>[#p<n>]`; VS Code DocumentLinkProvider for every language plus a hover with the title; a `vscode://` URI handler that opens the reader at a page; terminal `labshelf open <link>`; `navigator.registerProtocolHandler('web+labshelf', …)` on the browser library page.

#### S3 — Highlights in completion

- **Do:** inside the optional argument of `\cite[…]{key}` or after choosing a key, list that paper's highlights with page and text; insert the page; a second action inserts the quote with the citation.

#### S4–S6

- **Do:** an index `paper key → [{project, file, section}]` rebuilt from project scans; a "Cited in" section in the shared detail pane; the reading list per project with status from the library; `.labshelf/state.json` with the last file and cursor per user; the library home "Continue" row.

#### S8 — Lint rules

- **Do:** duplicate detection by DOI and `titleKey`; missing DOI; preprint → published through pdf-finding's published-version lookup (reuse it as is; if it lacks something the linter needs, extend it there); each rule returns a fix with the replacement entry.

#### S11–S12 — Dependencies

- **Do:** keep `papers:` in `labshelf.yaml` equal to the cited keys plus manual entries, each with its DOI; `install` resolves each missing paper by DOI through the core resolver chain and imports it.

#### S14 — OpenAlex

- **Do:** add a works-by-DOI call to the existing client in `core/src/import/registries/works/openalex.ts` that reads `referenced_works` and cited-by counts, cache per paper with a fetch date; the query counts how many library papers cite each missing work.

#### S17 — Zotero

- **Do:** copy `zotero.sqlite`, read items, creators, collections, tags, notes and attachments; map to `metadata.yaml`; copy PDFs; map annotations with page and rect to sidecar highlights.
- **Context:** never open the live database (Zotero locks it); log every item that cannot be mapped.

## 7. Risks

- **R1** Crossref and OpenAlex miss the preprint relation. — The linter only warns when a relation exists; no guessing by title alone.
- **R2** Zotero's schema changes between versions. — Read through a version check; fixture per supported schema.

## 8. Log

- 2026-10-15 21:20 — S1 core: `library/links` parser and contract `contracts/links.md` (main thread); VS Code, terminal and browser parts by three Sonnet implementers in parallel.
- 2026-10-15 21:50 — S1 verified in a real extension host: link in a `.py` file without `labshelf.yaml` opens the reader at page 5, hover shows the title; `labshelf open <link>` passes the page to a `{page}` viewer. Not verified: the `vscode://` URI (the package name `@labshelf/vscode` gives no usable extension id yet), Chrome dispatching a `web+labshelf:` click to the extension, Firefox.
- 2026-10-15 21:55 — S2 finish: gate passes in all four packages; `terminal/src/cli/libraryCommands.ts` stays at 217 lines (under the hard limit).
- 2026-10-15 22:10 — S3 by a Sonnet implementer: highlights complete inside `\cite[…]` (also with no key yet) and Typst `@key[…]`, with a quote variant; `[` is a trigger. Committed in f9ea804 by the parallel submission-tools session.
- 2026-10-15 22:20 — S4 core (main thread): `writing/backlinks` (citation sites with the heading above, index per project file and heading), Cited in section in the shared detail pane, `project.openSource` in the library UI contract. The heading title replaces "§3": numbers break across `\input` files.
- 2026-10-15 22:35 — S4 VS Code and S5 by a Sonnet implementer: backlink index service, Cited in in the list panel, Reading list node with the never-opened warning, `papers:` in `labshelf.yaml`. S6 by a Sonnet implementer: Continue rows in the Library view, `.labshelf/state.json` (device-local, never synced: there is no user identity to key it by). Main thread made Continue share the Writing view's project list.
- 2026-10-15 22:41 — S7 finish: gate passes in core and vscode. A2–A5 verified in a real extension host on a library copy. A3 stays open for the browser: it has no writing projects until writing-sync brings them; its host then fills `citedIn`. Not verified: Typst, Remove from Reading List, the browser-to-VS Code sidecar path for A5.
- 2026-10-15 22:54 — S8 (main thread): `writing/bibLint` parses user `.bib` files with offsets and lints duplicates (key, DOI, `titleKey`), missing DOIs (articles and proceedings only) and preprints with a published version through `publishedDoiOf` plus CrossRef, memoized per lookup. The published-version fix rewrites the entry as `@article` and keeps the key and the user's own fields; the missing-DOI fix is lazy and needs an exact title key and year match. The generated `labshelf.bib` is not linted: the library rewrites it, and its preprints are "Find Published Version"'s job.
- 2026-10-15 22:58 — S9 by a Sonnet implementer: `writing/bibliography` in VS Code lints `.bib` files on open and save (collection `labshelf-bib`), quick fixes apply only while the document is unchanged since the lint, and "Look up the DOI" asks CrossRef in `resolveCodeAction`.
- 2026-10-15 23:00 — S10 finish: gate passes in core and vscode (core's `writing/compare` typecheck error belongs to the parallel versions session). A6 verified in a real extension host against live arXiv and CrossRef: ATLAS 1207.7214 is replaced by its Physics Letters B entry with the key kept. That run showed CrossRef's 3000-name author list, so the fix keeps the entry's own `author` when the record lists more than 50. Not verified: applying the removal fix and a successful DOI lookup in the host, a `.bib` inside a LabShelf project.
