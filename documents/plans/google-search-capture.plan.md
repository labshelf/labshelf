# Plan: Save papers from Google search results

Status: draft
Size: M — one content script, one shared button extracted from the Scholar one, and a core host test over an existing rule table, all in the browser extension; grows to G if Google serves several result layouts that each need their own parser
Pending decisions: 0

## 1. Goal

A "Save to LabShelf" button appears next to the scholarly results of an ordinary Google search, as it does on Google Scholar and as Paperpile's does. Searching a DOI or a title in the address bar is enough to save the paper, without opening Scholar first.

## 2. Decisions

- [ ] **D1** The Scholar content script entry gains the glob `https://www.google.*/search*` in both manifests. The entry already matches `https://*/*`, so this adds no permission and no install warning.
- [ ] **D2** A result gets the button when its link's host is a scholarly host, or when its link or snippet carries a DOI, arXiv id or PMID. Scholarly hosts are the hosts of the publisher rule table (pdf-finding S8/S9) plus the repositories: PubMed, PMC, Europe PMC, arXiv, bioRxiv, medRxiv, SciELO, Semantic Scholar, OpenAlex and doi.org. The test is a pure core function, so the list lives in one place. Reference pages (SCIRP's `reference` pages, Wikipedia) get no button.
- [ ] **D3** One capture path for both pages. `ScholarHit` becomes `SearchHit`, and the Scholar capture resolves both kinds of hit: id in the links, then the landing page, then a title search checked against the printed year and authors. Google prints "de TF Smith · 1981" on scholarly results, which feeds that check.
- [ ] **D4** The split button and its states move out of `content/scholar.ts` into a shared result-button module, and the Scholar and Google scripts become thin page adapters: find results, read a hit, choose where to mount the button. The button sits on the result's URL line, in a shadow root, like Scholar's.
- [ ] **D5** Only organic web results on the "All" tab get the button. Ads, the AI overview, "People also ask", news, images and video results get none.
- [ ] **D6** No setting to turn it off — Scholar has none, and a result with no button costs nothing.

## 3. Scope

- **In:** the browser extension's content scripts and capture, a core scholarly-host test, both manifests.
- **Out:**
  - Bing, DuckDuckGo and other search engines — later, through the same page-adapter seam if asked.
  - A per-result PDF link like Scholar's "[PDF]" column — Google has none, so the chain finds the PDF.
  - Bulk saving from a results page.
- **Contracts touched:** none.

## 4. Acceptance criteria

- [ ] **A1** Searching `10.1016/0022-2836(81)90087-5` on google.com shows the button on the PubMed, ScienceDirect and Semantic Scholar results and not on the SCIRP reference page. Saving from the ScienceDirect result creates the Smith–Waterman paper with its DOI.
- [ ] **A2** Searching a paper's title shows the button on its publisher or repository results, and the saved paper's year and authors match the snippet.
- [ ] **A3** No button appears on ads, the AI overview, "People also ask", or on a search with no scholarly results.
- [ ] **A4** Google Scholar behaves as before: same button, states and capture. Its existing tests pass unchanged except for renamed types.
- [ ] **A5** Unit tests cover the scholarly-host test, Google hit parsing from 3 saved result-page fixtures (a DOI search, a title search, a Portuguese-locale page) and the ad and AI-overview exclusions. `pnpm -r typecheck` and `pnpm -r test` pass.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| Scholarly-host test | `core/src/import/pdfFinding/rules/` | `isScholarlyHost(url)` over the rule table plus the repository list. Pure. |
| Result button | `packages/browser/src/content/resultButton/` | Extracted from `content/scholar.ts`: split button, states, folder menu, "no PDF" ask. |
| Scholar adapter | `packages/browser/src/content/scholar/` | `scholar.ts` and `scholarParse.ts`, reduced to finding results and reading a hit. |
| Google adapter | `packages/browser/src/content/google/` | Finds organic results (`div#search` result blocks), reads title, link, snippet and the "author · year" line, and skips ads and modules. |
| Hit capture | `packages/browser/src/capture/` | `scholarCapture.ts` becomes `searchHitCapture.ts`, with `SearchHit` in `platform/runtimeMessages.ts`. |
| Manifests | `packages/browser/manifest.chrome.json`, `manifest.firefox.json` | One more `include_globs` entry. |

## 6. Sessions and steps

### Session 1 — Google results get the button

- **Starts from:** `feat/pdf-finding` with pdf-finding session 3 committed (the rule table exists)
- **Ends with:** A1–A5, the user's A1–A3 check in Chrome logged in §8
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | `isScholarlyHost` in core, with tests | — | M · implementer (sonnet) | host tests | [ ] |
| S2 | Extract the result button; Scholar becomes an adapter; `SearchHit` | — | M · module-splitter (sonnet) | A4 | [ ] |
| S3 | Google adapter, fixtures and manifest globs | S1–S2 | H · main thread | A3, A5 | [ ] |
| S4 | Finish; the user checks A1–A3 in Chrome | S1–S3 | `finish` skill + user | gate passes, §8 | [ ] |

### Step blocks

#### S1 — Scholarly-host test

- **Do:**
  - Add `isScholarlyHost(url)` beside the publisher rule table. It reads the table's hosts, so a new rule widens it on its own.
  - Add the repository hosts from D2.
  - Unit-test publisher, repository and non-scholarly hosts (`scirp.org/reference`, `wikipedia.org`).
- **Touch:** `core/src/import/pdfFinding/rules/`. **Do not touch:** the rules themselves.
- **Done when:** the host tests pass.

#### S2 — Shared result button

- **Do:**
  - Move the split button, its states and its menus out of `content/scholar.ts` into `content/resultButton/`, with no behaviour change.
  - Move `scholar.ts` and `scholarParse.ts` into `content/scholar/`.
  - Rename `ScholarHit` to `SearchHit` and `scholarCapture.ts` to `searchHitCapture.ts`, and update every importer and message name.
- **Touch:** `packages/browser/src/content/`, `capture/scholarCapture.ts`, `platform/runtimeMessages.ts`, the background capture handler, the build entry for the content script. **Do not touch:** core.
- **Context:** `content/scholar.ts` is at 199 lines, so the Google script cannot copy from it (AGENTS.md §1, "never copy code").
- **Done when:** A4, and the Scholar tests pass with only renames.

#### S3 — Google adapter

- **Do:**
  - Save 3 Google result pages as fixtures: a DOI search, a title search, and a `hl=pt-BR` page.
  - Parse organic results into `SearchHit`s, using `extractDoi`, `arxivIdFromUrl` and `pmidFromUrl` from core on the link and snippet, and the "author · year" line for authors and year.
  - Mount the button only where D2 and D5 allow, and watch for results Google adds after load.
  - Add `https://www.google.*/search*` to the content script's `include_globs` in both manifests.
- **Touch:** `packages/browser/src/content/google/`, both manifests, the build entry. **Do not touch:** `content/resultButton/` beyond its public API.
- **Done when:** A3 and A5.

#### S4 — Finish and user check

- **Do:** run `finish`, build `dist/chrome`, and hand the user the A1–A3 steps: the Smith–Waterman DOI search, one title search of their choice, and one search that should show no button.
- **Done when:** the gate passes and the user's result is in §8.

## 7. Risks

- **R1** Google changes its result markup, and the buttons disappear. Mitigation: the parser keys on stable anchors (the result link and its `h3`), the fixtures fail loudly, and no button appears rather than a wrong one.
- **R2** A non-article page on a publisher host gets a button, such as a journal home page. Mitigation: the capture resolves no id and no title match, so it ends in the existing "not a paper" message rather than a wrong save.

## 8. Log
