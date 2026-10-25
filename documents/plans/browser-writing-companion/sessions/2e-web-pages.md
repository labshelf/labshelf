# Session 2e — Library on web pages

- **Goal:** web pages show what the user already owns, and OpenReview submissions open in a reviewer mode.
- **Starts from:** sessions 1a and 1b committed (project store, runtime message types `sites.lookup` and `review.start`).
- **Ends with:** three criteria pinned in tests on fixture pages (session 3 does the live check). A7: "Opening an arXiv PDF of a library paper shows the 'You have this paper' offer." A8: "A Google Scholar result page marks the library papers." A9: "On an OpenReview submission, 'Review this submission' saves the PDF under `Reviews/` and opens the reader with a review draft."
- **Owns:** `packages/browser/src/content/sites/`, `packages/browser/src/content/scholar*.ts`, `packages/browser/src/content/index.ts`, `packages/browser/src/background/import/`, `packages/browser/src/background/reviews/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2e.1 | "You have this paper" on PDFs | behaviour | implementer (sonnet), test first | A7 logic in tests | [ ] |
| 2e.2 | Marks on arXiv and Semantic Scholar; "Cited in" on all three | behaviour | implementer (sonnet) | A8 fail-closed logic in tests | [ ] |
| 2e.3 | OpenReview reviewer mode | behaviour | implementer (sonnet), test first | A9 logic in tests | [ ] |
| 2e.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## Plan-wide decisions this session uses

- D7: on a publisher or arXiv PDF that matches a library paper, offer "You have this paper, with N highlights — open your copy".
- D8: Google Scholar, arXiv and Semantic Scholar result pages get an "In your library" mark, plus "Cited in <project>" when a project cites the paper. One small adapter per site; a broken adapter fails closed (no marks) and logs, so a fix stays local to one file.
- D9: on OpenReview, "Review this submission" saves the PDF into a private `Reviews/<venue>` folder, opens it in the reader and keeps a Markdown review draft with page references beside it.
- Runtime messages `sites.lookup` and `review.start` are typed in `packages/browser/src/platform/messages/` (session 1b); handlers export `handle<Name>(msg, deps): Promise<RuntimeResponse>`; session 3 wires them and gates which host may send what.

## 2e.1 — "You have this paper"

- **Goal:** a publisher or arXiv PDF that matches a library paper with a PDF offers the "open your copy" offer.
- **Read only:** `packages/browser/src/background/import/considerPdf.ts:1-87` (the match offers to attach a PDF); `packages/browser/src/background/import/offerHandlers.ts:1-84`; `packages/browser/src/background/import/offerStore.ts:1-72`; `packages/browser/src/background/import/offerBadge.ts:1-29`.
- **Decided:** reuse `matchPdfToPaper` (DOI or arXiv id in the URL, then `titleKey`); a matched paper with a PDF gets the "open your copy" offer, one without keeps the attach offer.
- **Done when:** tests in `packages/browser/__tests__/background/import/`, written first, pin both offers and the highlight count.

## 2e.2 — Library marks

- **Goal:** results on arXiv and Semantic Scholar get "In your library"; on those and Google Scholar, "Cited in <project>" when a browser project cites the paper.
- **Read only:** `packages/browser/src/content/scholar.ts:60-80` and `:170-199` (the existing Scholar mark and lookup); `packages/browser/src/content/scholarParse.ts:1-107`; `packages/browser/src/background/handlers/library.ts:90-119` (`handleLibraryLookup`); `packages/core/src/writing/citations/scanCitations.ts:1-62`; `packages/browser/src/storage/projects/index.ts` (`listBrowserProjects`, `readProjectFile(id, path)`).
- **Decided:** one adapter per site in `content/sites/`, a shared mark in the Scholar shadow style; `sites.lookup` extends the existing lookup with citing projects.
- **Done when:** fixture-page tests in `packages/browser/__tests__/content/sites/` pin the parse per site and the fail-closed path (a broken parse hides marks and logs); mark styling gets no test.

## 2e.3 — OpenReview

- **Goal:** on an OpenReview submission, "Review this submission" saves the PDF into the library folder `Reviews/<venue>/` and opens the reader with `review.md` beside it.
- **Read only:** `packages/browser/src/background/handlers/capture.ts:1-80`; `packages/browser/src/capture/captureService.ts:1-60`; `packages/browser/src/storage/libraryMutations.ts:1-132`; `packages/core/src/writing/quotes/index.ts`.
- **Decided:** `content/sites/openreview.ts` adds the button; `background/reviews/` handles `review.start`; `review.md` starts with the title and a page-reference template.
- **Done when:** tests in `packages/browser/__tests__/background/reviews/`, written first, pin the folder, the PDF and the draft. `pnpm --filter @labshelf/browser typecheck && pnpm --filter @labshelf/browser test`.

- **Do not touch (all packages):** `packages/browser/src/content/editors/`, `router.ts`, manifests, `build/`; session 2d's paths (`reader/`, `background/citeInProject/`).
