# Session 9 — CodeMirror editor with LaTeX features and the live preview

- **Goal:** source tabs open in a lazy CodeMirror 6 editor with LaTeX language features from core, saves through `LibraryFileSystem`, and the preview tab shows the reader in preview mode updated page by page from the helper.
- **Starts from:** session 8 committed.
- **Ends with:** A4; A7 for LaTeX with whole-document builds; the helper setup card shows in the preview tab when no helper answers.
- **Owns:** `packages/browser/src/library-page/editor/` (except `typst/`, `collab/`), `packages/browser/src/library-page/preview/`, `packages/browser/src/reader/` (preview boot only), `packages/browser/package.json` and the lockfile (CodeMirror entries), their tests.

Runs alone: it adds dependencies.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 9.1 | Editor tab and LaTeX language | behaviour | implementer (opus) | completion and close tests pass | [ ] |
| 9.2 | Preview tab and build loop | behaviour | implementer (sonnet) | page swap test passes, A7 headless | [ ] |
| 9.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 9.1 — Editor and LaTeX

- **Read only:** `packages/core/src/writing/latex/catalog/` index (`LATEX_COMMANDS`, `LATEX_ENVIRONMENTS`, `environmentToClose`); `packages/vscode/src/writing/latexEditing/commands/` (the VS Code adapter to mirror); `packages/core/src/writing/citations/` index (`partialKeyStart`, `citationSnippet`, `papersByCiteKey`); `packages/vscode/src/writing/citations/citationCompletion.ts:1-40`; the label scan in `scanLatexSource` (`packages/core/src/writing/latex/source/`); `packages/core/src/library-ui/dom/editorArea/` index from session 8.
- **Decided:** dependencies `@codemirror/state`, `view`, `commands`, `language`, `autocomplete`, `lint`, `search` and `@codemirror/legacy-modes` (stex) only; no LaTeX LSP. The editor chunk is a dynamic `import()` of `editor/index.ts`, mounted by a source tab. Completion sources: commands and environments from the core catalog, `\begin{x}` + Enter inserts `\end{x}` via `environmentToClose`, `\ref`/`\eqref`/`\cref` from labels of the project's scanned files, `\cite` family from the library with the VS Code item shape (label citeKey + year, detail title, filter "key title authors"). Theme from core tokens only. Saves debounced 1 s after the last edit and on tab close; a failed write keeps the tab dirty and logs. Edits also go to the helper as `edit` messages. Scans for labels run debounced 300 ms over the changed file only.
- **Done when:** tests over `EditorState` pin completion results and auto-close; browser typecheck and test.
- **Do not touch:** `packages/browser/src/editor/`, `packages/core/`.

## 9.2 — Preview

- **Read only:** `documents/plans/browser-project-workspace/research/browser-runtime.md` (Reader); `packages/browser/src/reader/index.ts:1-170`; `packages/core/src/reader/dom/session/documentReload.ts:22-60`; `packages/core/src/reader/dom/startup/hostMessages.ts:39`; `packages/browser/src/helper/client/` index (session 5 API); `packages/browser/src/helper/setup/setupCard.ts`.
- **Decided:** the preview tab is an iframe of the reader page with `?preview=1`, which sets `boot.preview: true`; the page posts `buildStatus` and `reloadDocument`; changed pages from `compile` are merged into the last PDF bytes held by the preview tab (whole-PDF replace when `changed` covers all pages) and handed over as a `blob:` URL, revoked on the next reload. Preview builds run after 500 ms idle with `mode: "preview"`; save triggers `"full"`. Problems go to the editor's lint source on their line. Closing the tab removes the iframe.
- **Done when:** a test pins the build scheduling (debounce, preview vs full, cancel on new edit); a headless run shows the preview keeping its scroll position after an edit.
