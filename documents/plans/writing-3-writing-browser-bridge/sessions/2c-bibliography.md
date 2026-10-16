# Session 2c — Bibliography link and health

- **Goal:** the panel creates and revokes a read-by-link URL for the project's `labshelf.bib` and shows bibliography health.
- **Starts from:** sessions 1a and 1b committed (project store, runtime message types).
- **Ends with:** Q1 answered and reported; the `labshelf.bib` link and the health section. A4: "The panel shows the `labshelf.bib` URL; added to Overleaf, it compiles with the cited entries." A5: "The health list names a cited key missing from the library and imports it by DOI in one click." Both are pinned in tests; session 3 does the live check.
- **Owns:** `packages/browser/src/side-panel/health/`, `packages/browser/src/background/bibliography/`, `packages/core/src/sync/drive/`, `documents/contracts/sync.md`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2c.1 | Task: Q1 test with the user | task | user + main thread | Q1 answered | [ ] |
| 2c.2 | `labshelf.bib` link on Drive (per Q1) | contract | implementer (sonnet), tests first; then architecture-reviewer | A4 logic in tests | [ ] |
| 2c.3 | Read project sources; health section; import by DOI | behaviour | implementer (opus), test first | A5 logic in tests | [ ] |
| 2c.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## Plan-wide decisions this session uses

- D4: LabShelf keeps the project's `labshelf.bib` on Drive with an "anyone with the link can read" permission and gives the user that URL for Overleaf's "From external URL" file, which Overleaf refreshes on click. The panel says the file is readable by anyone with the link before creating the link; the user can revoke it (a public link can leak a reading list).
- D5: health reads the project's sources through Overleaf's own source download in the user's session and lists cited keys in the library, cited keys missing (one-click import by DOI), and papers with poor metadata.
- Runtime messages `bib.link` and `bib.health` are typed in `packages/browser/src/platform/messages/` (session 1b). Handlers export `handle<Name>(msg, deps): Promise<RuntimeResponse>`; sections export `mount<Name>Section(root, deps)`. Session 3 wires them.

## 2c.1 — Task

- The user adds a "From external URL" file in an Overleaf project pointing at a Drive download link of a file shared "anyone with the link", and reports whether it loads and refreshes. Report the answer in the session summary (the main thread records it as the answer to plan question Q1). If the answer is "no", 2c.2 serves the file from a user-created GitHub Gist instead and its brief is rewritten before delegation.

## 2c.2 — `labshelf.bib` link

- **Goal:** the panel creates, shows and revokes a read-by-link URL for the project's `labshelf.bib` on Drive.
- **Read only:** `packages/core/src/sync/drive/googleDriveClient.ts:40-190` (methods, auth header); `packages/core/src/sync/drive/index.ts`; `documents/contracts/sync.md:29-43`; `packages/browser/src/storage/projects/index.ts` (`listBrowserProjects`, `readProjectFile`).
- **Decided:** client methods `shareByLink(fileId)` and `revokeLink(fileId)` over the Drive permissions endpoint (role `reader`, type `anyone`); the URL is the direct download form. The panel shows "Anyone with this link can read the file" before creating it. `sync.md` states that only `labshelf.bib` can carry a link permission and only on request. `handleBibLink` handles `bib.link`; the link row is exported for the health section.
- **Done when:** tests in `packages/core/__tests__/sync/drive/` (fake fetch) and `packages/browser/__tests__/background/bibliography/`, written first, pin create, show and revoke. `architecture-reviewer` reviews the diff against `sync.md` (Drive writes).
- **Do not touch:** the sync engine; other Drive calls.

## 2c.3 — Health section

- **Goal:** `mountHealthSection(root, deps)` lists cited keys in the library, cited keys missing (one-click import by DOI) and papers with poor metadata.
- **Read only:** `packages/core/src/writing/citations/citationKeys.ts:1-62` (`scanCitationKeys`); `packages/core/src/writing/bibLint/lintBibliography.ts:1-18`; `packages/core/src/writing/bibLint/localRules.ts:1-57`; `packages/browser/src/background/handlers/citationMap.ts:1-41` (import by DOI exists); `packages/browser/src/capture/tab/tabFetch.ts:1-61` (fetch in the user's session).
- **Decided:** the background fetches the project's source download in the user's session (Overleaf zip, typst.app project download). TRAP: no zip dependency is installed; `DecompressionStream("deflate-raw")` with a central-directory walk covers stored and deflated entries; adding a dependency instead changes `package.json`, so it needs its own session run alone. A failed download shows "Health unavailable" and logs; insertion keeps working. `handleBibHealth` handles `bib.health`.
- **Done when:** tests in `packages/browser/__tests__/background/bibliography/` pin the three lists from a fixture archive and the import call; the section's DOM gets no test. `pnpm --filter @labshelf/browser typecheck && pnpm --filter @labshelf/browser test`; `pnpm --filter @labshelf/core test`.
- **Do not touch:** the core scanner and lint rules; `side-panel/search/`; sibling sessions' paths (`library-page/`, `content/`).
