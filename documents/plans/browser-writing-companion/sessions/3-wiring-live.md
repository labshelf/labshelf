# Session 3 — Wiring and live checks

- **Goal:** every module from sessions 1a–2e is composed in the built extension and checked for real.
- **Starts from:** sessions 1a to 2e committed.
- **Ends with:** A1–A9 (no A4) checked in the built extension, A2, A3, A5 and A6 on the live sites with the user:
  - A1 A project synced from VS Code shows in the browser's Writing tab with its PDF.
  - A2 In an Overleaf editor, picking a paper in the side panel inserts `\cite{key}` at the cursor; the same in typst.app inserts `@key`.
  - A3 With `insertText` blocked, the panel copies the citation and says so.
  - A5 The health list names a cited key missing from the library and imports it by DOI in one click.
  - A6 "Cite in project" on a reader highlight inserts `\cite[p.~4]{key}` into the open Overleaf tab.
  - A7 Opening an arXiv PDF of a library paper shows the "You have this paper" offer.
  - A8 A Google Scholar result page marks the library papers.
  - A9 On an OpenReview submission, "Review this submission" saves the PDF under `Reviews/` and opens the reader with a review draft.
- **Owns:** `packages/browser/src/background/router.ts`, `packages/browser/src/background/index.ts`, `packages/browser/src/side-panel/index.html`, `packages/browser/src/side-panel/main.ts`, `packages/browser/build/`, `packages/browser/manifest.chrome.json`, `packages/browser/manifest.firefox.json`

Runs alone: it changes manifests and a build script, and a host verify needs a green whole-repo build.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Router: dispatch and the page-message gate per host | contract | implementer (sonnet), tests first | gate tests pass | [ ] |
| 3.2 | Manifests, build entries, side panel page shell | contract | implementer (sonnet), tests first | build of both targets; manifest test | [ ] |
| 3.3 | Headless verify and live checks | — | `verify` skill + user | A1–A9 (no A4) | [ ] |
| 3.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## Modules to wire

Each lives in a folder `index.ts` and exports `handle<Name>(msg, deps): Promise<RuntimeResponse>` and, for page code, `mount<Name>Section(root, deps)`:

- `background/editors/` handles `editor.insert` (answers `"inserted" | "copied" | "no-editor"`); `side-panel/search/` mounts the search section.
- `background/bibliography/` handles `bib.health`; `side-panel/health/` mounts the health section.
- `background/citeInProject/` handles `cite.inProject` and exports `registerCiteMenu(deps)`.
- `background/pdfOffer/` and `content/sites/`: lookups (`sites.lookup`); `background/reviews/` handles `review.start`.
- Core `mountWritingTab(root, host)` is already mounted by `library-page/`.

## 3.1 — Router

- **Goal:** the router dispatches the new messages and lets a web page send only what its content script needs.
- **Read only:** `packages/browser/src/background/router.ts:1-121`; `packages/browser/src/background/index.ts:1-70`; the `index.ts` of `background/editors/`, `bibliography/`, `citeInProject/`, `reviews/`, `pdfOffer/`.
- **Decided:** overleaf.com and typst.app may send only `editor.*`; arXiv, Semantic Scholar and Scholar only the lookup messages; openreview.net only `review.start`. TRAP: the gate is the trust boundary for page input; every message is validated before dispatch.
- **Done when:** tests in `packages/browser/__tests__/background/router.test.ts`, written first, pin each host's allowed and refused types.

## 3.2 — Manifests and page shell

- **Goal:** the extension declares and builds everything the earlier sessions added.
- **Read only:** `packages/browser/manifest.chrome.json`; `packages/browser/manifest.firefox.json`; `packages/browser/build/build.mjs:10-60`; `packages/browser/src/library-page/main.ts:1-47` (a page entry).
- **Decided:** Chrome `side_panel` and `sidePanel` permission, Firefox `sidebar_action`; overleaf.com and typst.app as optional host permissions requested from the panel; content scripts for editors, sites and OpenReview; `contextMenus`. The shell mounts the search and health sections.
- **Done when:** `pnpm --filter @labshelf/browser build` for both targets; a manifest test, written first, pins the entries.

## 3.3 — Verify

- Deliverable is the check itself. Headless run per `documents/apps/verify.md#rules`: A1 (fake bridge host), A7, A8 (fixture pages), A9. With the user, on live Overleaf and typst.app: A2, A3 (block `insertText` from DevTools), A5, A6. Risk: the modules pass their tests but fail once composed, and the live editors may reject synthetic input; report each failure with its criterion id.
