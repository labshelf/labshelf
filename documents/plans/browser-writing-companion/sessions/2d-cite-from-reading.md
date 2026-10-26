# Session 2d — Cite from reading

- **Goal:** the reader and page selections can send a citation or quote into a writing project.
- **Starts from:** sessions 1a and 1b committed (the `citeInProject` reader message and optional host port, runtime message types, project store).
- **Ends with:** "Cite in project" in the reader and on page selections. A6: "'Cite in project' on a reader highlight inserts `\cite[p.~4]{key}` into the open Overleaf tab." It is pinned in tests; session 3 does the live check.
- **Owns:** `packages/core/src/reader/dom/chrome/`, `packages/browser/src/reader/`, `packages/browser/src/background/citeInProject/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2d.1 | Reader action "Cite in project" | behaviour | implementer (sonnet) | typecheck of core | [ ] |
| 2d.2 | Browser host port, background handler, selection menu | behaviour | implementer (sonnet), test first | A6 logic in tests | [ ] |
| 2d.3 | Check, commit | — | `pnpm gate` on Owns, `git commit` of Owns | gate passes | [ ] |

## Plan-wide decision this session uses

D6: in the reader, "Cite in project" on a highlight inserts the citation (with the page) into the active Overleaf or typst.app tab through the standard `insertText` path, or into a project file through the native bridge of plan `folder-sync`. A selection on any web page can be sent to a project the same way, as a quote with its reference.

Seams from session 1b: reader message `{ command: "citeInProject"; paperId; page?; quote? }` with an optional host port `citeInProject(request)`; runtime message `cite.inProject`; `editor.insert {text, fallback}` answering `InsertOutcome = "inserted" | "copied" | "no-editor"`. Session 2b implements `editor.insert`; tests here use a fake.

## 2d.1 — Reader action

- **Goal:** the selection bubble on a highlight offers "Cite in project", which sends `citeInProject` with the paper, page and quote.
- **Read only:** `packages/core/src/reader/dom/chrome/selectionBubble.ts:1-102`; `packages/core/src/reader/protocol.ts:130-200` (the message); `packages/core/src/reader/citationFormat.ts:1-42`.
- **Decided:** an icon button from the core icon set beside "Copy with citation"; shown only when the host reports the port.
- **Done when:** `pnpm --filter @labshelf/core typecheck`. No test (UI).
- **Do not touch:** `packages/core/src/reader/host/`, `protocol.ts`.

## 2d.2 — Browser side

- **Goal:** the browser host implements `citeInProject`: insert into the active Overleaf or typst.app tab, else into the project's main file at its stored cursor; a context-menu entry on page selections sends a quote with its reference.
- **Read only:** `packages/browser/src/reader/index.ts:1-80`; `packages/browser/src/reader/inPageTransport.ts:1-39`; `packages/core/src/writing/citations/pageArgument.ts:1-58`; `packages/core/src/writing/citations/citedText.ts:1-25`; `packages/core/src/writing/project/index.ts` (`ProjectCursor`); `packages/browser/src/storage/projects/index.ts` (`listBrowserProjects`, `readProjectFile(id, path)`, `writeProjectFile(id, path, bytes)`).
- **Decided:** the citation is `\cite[p.~4]{key}` or `@key[p. 4]`; `handleCiteInProject(msg, deps)` sends `editor.insert` and falls back to the project file. `registerCiteMenu(deps)` is exported from `background/citeInProject/index.ts` for session 3, which adds the `contextMenus` permission.
- **Done when:** tests in `packages/browser/__tests__/background/citeInProject/`, written first, pin tab insert, file fallback and the selection quote (A6). `pnpm --filter @labshelf/browser typecheck && pnpm --filter @labshelf/browser test`.
- **Do not touch:** `packages/browser/src/background/editors/`, `router.ts`, manifests; session 2e's paths (`content/sites/`, `background/import/`, `background/reviews/`).
