# Session 14 — live collaboration in the browser editor

- **Goal:** the browser editor joins projects shared from VS Code through plan project-collaboration's protocol, with edits, cursors and comments live both ways.
- **Starts from:** session 13 committed; plan project-collaboration sessions 2–5, 7 and 10 committed.
- **Ends with:** A13 (second half).
- **Owns:** `packages/browser/src/library-page/editor/collab/`, its tests, the `yjs` and `y-codemirror.next` entries in `packages/browser/package.json` and the lockfile.

Runs alone: it adds dependencies.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 14.1 | Join shared projects | behaviour | implementer (opus) | two-peer test passes | [ ] |
| 14.2 | Real session with VS Code | task | main thread | cursors and a comment both ways | [ ] |
| 14.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 14.1 — Join

- **Read only:** `documents/contracts/collaboration.md`; `documents/contracts/relay.md`; `packages/core/src/collab/index.ts` and `collab/dom/index.ts`; `packages/core/src/collab/comments/` index; `packages/browser/src/library-page/editor/index.ts`.
- **Decided:** the page runs the core session and the relay transport natively; `y-codemirror.next` binds each open file's Yjs text and awareness; a per-user `Y.UndoManager` per file. The invite link is pasted in the page or comes from the hash; its `#fragment` carries the share key, which stays in extension storage, never in the project folder. Comments use the core store on the index doc. Nothing is copied from `packages/vscode/`.
- **Done when:** a test joins two in-memory peers, one bound to an `EditorView`, and an edit and a comment reach the other.
- **Do not touch:** `packages/vscode/`, core contracts.

## 14.2 — Real session

Share a project from an isolated `@vscode/test-electron` host (own user-data-dir; ask the user first; stop only the launched PID) and join it from the page in Chrome for Testing. Observe cursors both ways and a comment both ways; report what was not checked.
