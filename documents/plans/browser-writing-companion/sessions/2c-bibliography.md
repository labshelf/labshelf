# Session 2c — Bibliography link and health

- **Goal:** the panel shows bibliography health.
- **Starts from:** sessions 1a and 1b committed (project store, runtime message types).
- **Ends with:** the health section. A5: "The health list names a cited key missing from the library and imports it by DOI in one click." It is pinned in tests; session 3 does the live check.
- **Owns:** `packages/browser/src/side-panel/health/`, `packages/browser/src/background/bibliography/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2c.3 | Read project sources; health section; import by DOI | behaviour | implementer (opus), test first | A5 logic in tests | [ ] |
| 2c.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## Plan-wide decisions this session uses

- D5: health reads the project's sources through Overleaf's own source download in the user's session and lists cited keys in the library, cited keys missing (one-click import by DOI), and papers with poor metadata.
- The runtime message `bib.health` is typed in `packages/browser/src/platform/messages/` (session 1b). Handlers export `handle<Name>(msg, deps): Promise<RuntimeResponse>`; sections export `mount<Name>Section(root, deps)`. Session 3 wires them.

## 2c.3 — Health section

- **Goal:** `mountHealthSection(root, deps)` lists cited keys in the library, cited keys missing (one-click import by DOI) and papers with poor metadata.
- **Read only:** `packages/core/src/writing/citations/scanCitations.ts:1-62` (`scanCitationKeys`); `packages/core/src/writing/bibliography/checkBibliography.ts:1-18`; `packages/core/src/writing/bibliography/localRules.ts:1-57`; `packages/browser/src/background/handlers/citationMap.ts:1-41` (import by DOI exists); `packages/browser/src/capture/tab/tabFetch.ts:1-61` (fetch in the user's session).
- **Decided:** the background fetches the project's source download in the user's session (Overleaf zip, typst.app project download). TRAP: no zip dependency is installed; `DecompressionStream("deflate-raw")` with a central-directory walk covers stored and deflated entries; adding a dependency instead changes `package.json`, so it needs its own session run alone. A failed download shows "Health unavailable" and logs; insertion keeps working. `handleBibHealth` handles `bib.health`.
- **Done when:** tests in `packages/browser/__tests__/background/bibliography/` pin the three lists from a fixture archive and the import call; the section's DOM gets no test. `pnpm --filter @labshelf/browser typecheck && pnpm --filter @labshelf/browser test`; `pnpm --filter @labshelf/core test`.
- **Do not touch:** the core scanner and lint rules; `side-panel/search/`; sibling sessions' paths (`libraryUi/`, `content/`).
