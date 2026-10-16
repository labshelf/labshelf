# Plan: Save papers from Google search results

Status: draft
Size: 1 session — one content script, one shared button extracted from the Scholar one, and a core host test over an existing rule table; grows if Google serves several result layouts that each need their own parser

## 1. Goal

A "Save to LabShelf" button appears next to the scholarly results of an ordinary Google search, as it does on Google Scholar and as Paperpile's does. Searching a DOI or a title in the address bar is enough to save the paper, without opening Scholar first.

## 2. Decisions

- [ ] **D1** The Scholar content script entry gains the glob `https://www.google.*/search*` in both manifests. The entry already matches `https://*/*`, so this adds no permission and no install warning.
- [ ] **D2** A result gets the button when its link's host is a scholarly host, or when its link or snippet carries a DOI, arXiv id or PMID. Scholarly hosts are the hosts of the publisher rule table (`core/src/import/pdfFinding/rules/`) plus PubMed, PMC, Europe PMC, arXiv, bioRxiv, medRxiv, SciELO, Semantic Scholar, OpenAlex and doi.org. The test is a pure core function `isScholarlyHost(url)`, so the list lives in one place. Reference pages (SCIRP's `reference` pages, Wikipedia) get no button.
- [ ] **D3** One capture path for both pages. `ScholarHit` becomes `SearchHit`, and the Scholar capture resolves both kinds of hit: id in the links, then the landing page, then a title search checked against the printed year and authors. Google prints "de TF Smith · 1981" on scholarly results, which feeds that check.
- [ ] **D4** The split button and its states move out of `content/scholar.ts` into a shared result-button module (`packages/browser/src/content/resultButton/`), and the Scholar and Google scripts become thin page adapters: find results, read a hit, choose where to mount the button. The button sits on the result's URL line, in a shadow root, like Scholar's.
- [ ] **D5** Only organic web results on the "All" tab get the button. Ads, the AI overview, "People also ask", news, images and video results get none.
- [ ] **D6** No setting to turn it off — Scholar has none, and a result with no button costs nothing.
- [ ] **D7** Out of scope: Bing, DuckDuckGo and other engines (later, through the same page-adapter seam); a per-result PDF link like Scholar's "[PDF]" column (Google has none, so the chain finds the PDF); bulk saving from a results page. No contract is touched.
- [ ] **D8** Google changes its markup: the parser keys on stable anchors (the result link and its `h3`), fixtures fail loudly, and no button appears rather than a wrong one. A non-article page on a publisher host ends in the existing "not a paper" message.

## 3. Acceptance

- [ ] **A1** Searching `10.1016/0022-2836(81)90087-5` on google.com shows the button on the PubMed, ScienceDirect and Semantic Scholar results and not on the SCIRP reference page. Saving from the ScienceDirect result creates the Smith–Waterman paper with its DOI.
- [ ] **A2** Searching a paper's title shows the button on its publisher or repository results, and the saved paper's year and authors match the snippet.
- [ ] **A3** No button appears on ads, the AI overview, "People also ask", or on a search with no scholarly results.
- [ ] **A4** Google Scholar behaves as before: same button, states and capture. Its existing tests pass unchanged except for renamed types.
- [ ] **A5** Unit tests cover the scholarly-host test, Google hit parsing from 3 saved result-page fixtures (a DOI search, a title search, a Portuguese-locale page) and the ad and AI-overview exclusions. `pnpm -r typecheck` and `pnpm -r test` pass.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | Google results get the button; A1–A5 | `packages/core/src/import/pdfFinding/rules/`, `packages/browser/src/content/`, `packages/browser/src/capture/`, `packages/browser/src/platform/runtimeMessages.ts`, the browser background capture handler and content-script build entry, `packages/browser/manifest.chrome.json`, `packages/browser/manifest.firefox.json` | alone |
