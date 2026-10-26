# Session 2b — Panel search and insertion

- **Goal:** the side panel searches the library and inserts a citation into an Overleaf or typst.app editor, with a clipboard fallback.
- **Starts from:** sessions 1a and 1b committed (runtime message types in `packages/browser/src/platform/messages/`).
- **Ends with:** the panel search section and the editor adapters. A2: "In an Overleaf editor, picking a paper in the side panel inserts `\cite{key}` at the cursor; the same in typst.app inserts `@key`." A3: "With `insertText` blocked, the panel copies the citation and says so." Both are pinned in tests; session 3 does the live check.
- **Owns:** `packages/browser/src/side-panel/search/`, `packages/browser/src/content/editors/`, `packages/browser/src/background/editors/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2b.1 | Panel search section | behaviour | implementer (sonnet), test first for the citation format | format tests pass | [ ] |
| 2b.2 | Editor adapters and background relay | behaviour | implementer (opus), test first | A2, A3 logic in tests | [ ] |
| 2b.3 | Check, commit | — | `pnpm gate` on Owns, `git commit` of Owns | gate passes | [ ] |

## Plan-wide decisions this session uses

- D2: the integration lives in the side panel, not in the editors' DOM. D3: insertion uses only `insertText` on the focused editable element (CodeMirror treats it as typing); if that fails, Enter copies the citation and says so.
- Runtime message `editor.insert {text, fallback}` answers `InsertOutcome = "inserted" | "copied" | "no-editor"` (types in `platform/messages/`, session 1b). Session 2d calls it with a fake; session 3 wires it into the router and requests the host permissions (optional host permissions for overleaf.com and typst.app).

## 2b.1 — Search section

- **Goal:** `mountSearchSection(root, deps)` searches the library with core search; Enter on a paper asks to insert its citation.
- **Read only:** `packages/core/src/library/search/index.ts`; `packages/core/src/library/search/searchDoc.ts:1-40`; `packages/core/src/reader/citationFormat.ts:1-42`; `packages/core/src/writing/citations/citationCompletion.ts:1-21`; `packages/browser/src/platform/messages/`.
- **Decided:** `\cite{key}` for Overleaf, `@key` for typst.app, chosen by the tab's host. On `"copied"` the section says "Copied \cite{key}: paste it in the editor"; the copy runs in the panel, which has the user gesture. Export the section from `side-panel/search/index.ts` for session 3.
- **Done when:** tests in `packages/browser/__tests__/side-panel/search/` pin the citation format per host and the copy-on-`"copied"` path; the DOM layout and notice copy get no test.
- **Do not touch:** the panel page shell, `side-panel/health/`.

## 2b.2 — Editor adapters

- **Goal:** per site, insert text at the editor cursor through the standard path, or report that it did not land.
- **Read only:** `packages/browser/src/content/scholar.ts:1-30` (content-script shape); `packages/browser/src/content/shadowTheme.ts:1-37`; `packages/browser/src/background/registerHandlers.ts:15-25` (page-message gate); `packages/browser/src/capture/tab/scripting.ts:1-8`.
- **Decided:** one adapter per site (`content/editors/overleaf.ts`, `typstApp.ts`): find the focused editable, call `document.execCommand("insertText")`, fall back to an `InputEvent`, then check the text landed; no other editor DOM is read. `background/editors/` exports `handleEditorInsert(msg, deps): Promise<RuntimeResponse>`, relays `editor.insert` to the active tab and returns `InsertOutcome`. Risk: Overleaf or typst.app may reject synthetic input; the clipboard fallback is part of the design.
- **Done when:** jsdom tests in `packages/browser/__tests__/content/editors/` and `__tests__/background/editors/`, written first, pin inserted, blocked (leads to the `"copied"` path) and no-editor; `pnpm --filter @labshelf/browser typecheck && pnpm --filter @labshelf/browser test`.
- **Do not touch:** `packages/browser/src/background/registerHandlers.ts`, manifests, `build/`, sibling sessions' paths (`libraryUi/`, `side-panel/health/`, `content/sites/`).
