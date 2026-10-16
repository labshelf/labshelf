# Session 2c — Browser wiring

- **Wave:** 2, runs at the same time as [2a-core-list.md](2a-core-list.md) and [2b-vscode.md](2b-vscode.md)
- **Starts from:** 1a and 1b committed
- **Ends with:** A14, A15 and A8 in the browser, covered by unit tests; the real-page check is session 3
- **Commit:** yes, at the end of the session, owned files only
- **Research:** sidebar.md, log.md line for Q3

## Owns
`packages/browser/src/library-page/` (`sidebarTree.ts`, `page.css`, listing and description adapters), the browser composition root lines for them, their mirrors under `packages/browser/__tests__/`.
**Do not touch:** `packages/core/`, `packages/vscode/`. A missing core piece is reported, not added here. Nothing is copied from VS Code.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2c.1 | `sidebarTree.ts` consumes the core derivation: scopes, papers with REF, selected mark, click → `revealPaper` | — | M · test-writer, then implementer | A14, A15 | [ ] |
| 2c.2 | IndexedDB listing and description adapters (Q3 = yes: every file) | — | M · test-writer, then implementer | A8 | [ ] |
| 2c.3 | Finish, commit | 2c.1–2c.2 | `finish`, `commit-splitter` | gate passes | [ ] |

## 2c.1 — Side bar
- **Do:** replace the browser-only folder walk (`countPapersUnder`) with the core derivation; tree CSS in `library-page/page.css` uses tokens only; keep DnD, context menu, keys and saved expansion. Delete code the derivation replaces.
- **Test first:** scopes and paper rows render; click posts a reveal for a hidden paper (the tray opening is 2a, checked in session 3).

## 2c.2 — Adapters
- **Do:** listing from IDB records under `papers/<id>/` with size and mtime; description write goes through the same core metadata path as the other apps.

## 2c.3 — Finish, commit
- Gate failures in core files belong to 2a or 1b: report them, do not fix them.
