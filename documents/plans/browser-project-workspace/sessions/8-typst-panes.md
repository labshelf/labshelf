# Session 8 — Typst through the helper, project panes, comments, history and versions

- **Goal:** Typst source tabs get Tinymist features over the helper, and comments, project history and versions work in the browser as in VS Code.
- **Starts from:** session 7 committed.
- **Ends with:** A5; the comment, history and versions parts of A13.
- **Owns:** `packages/browser/src/library-page/editor/typst/`, `packages/browser/src/library-page/review/`, their tests; `@codemirror/lsp-client` or equivalent entry only if 8.1 decides it (then the session runs alone).

Runs with session 9 when 8.1 adds no dependency.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 8.1 | Typst LSP over the helper | behaviour | implementer (opus) | LSP adapter tests pass, A5 headless with a real helper | [ ] |
| 8.2 | Comments, history, versions | behaviour | implementer (sonnet) | A13 (first half) headless | [ ] |
| 8.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 8.1 — Typst LSP

- **Read only:** `documents/contracts/helper.md` (`lsp`, `edit`, `compile`); `packages/browser/src/helper/client/` index; `packages/browser/src/library-page/editor/index.ts` (session 7); `packages/core/src/writing/citations/` index; `packages/core/src/writing/typst/source/typstHeadings.ts:47`.
- **Decided:** a small LSP client in `editor/typst/` over the helper's `lsp` channel: `initialize`, `didOpen`/`didChange` (incremental), `completion`, `hover`, `publishDiagnostics`, `definition` (opens the target file in a tab); citation completion from the library is merged ahead of Tinymist's for `@key`. Syntax highlighting from Tinymist semantic tokens if cheap, else a Lezer-free stream mode. Use an existing CodeMirror LSP package only if it works over a custom transport and is smaller than the hand-written client (AGENTS.md section 3 ladder). No typst.ts code is imported.
- **Done when:** tests over a fake channel pin request/response mapping; real run with a `@preview` import compiles (A5), reported with what was not checked.

## 8.2 — Comments, history, versions

- **Read only:** `packages/core/src/collab/comments/` index; the core project history and versions modules (find with one grep of `versions` under `packages/core/src/writing/`); the VS Code comments controller index in `packages/vscode/src/collab/comments/`; `packages/browser/src/library-page/editor/index.ts`.
- **Decided:** comments anchor with the core store and show as CodeMirror gutter marks plus a thread panel in a right-hand tab; history and versions are the core views mounted in a tab, writing through `LibraryFileSystem`. Anything VS Code-only that the browser needs moves to core first, in this package.
- **Done when:** headless run adds, replies to and resolves a comment that persists in `.labshelf/comments.json`; a version is created and restored.
