# Session 2b — VS Code wiring

- **Wave:** 2, runs at the same time as [2a-core-list.md](2a-core-list.md) and [2c-browser.md](2c-browser.md)
- **Starts from:** 1a and 1b committed
- **Ends with:** A14–A16 and A8 in VS Code, covered by unit tests; the real-host check is session 3
- **Commit:** yes, at the end of the session, owned files only
- **Research:** sidebar.md

## Owns
`packages/vscode/src/ui/library/`, `packages/vscode/src/ui/libraryWebview/`, REF icon generation next to `ui/arcMarkIcons.ts`, the vscode composition root lines for the listing adapter, their mirrors under `packages/vscode/__tests__/`.
**Do not touch:** `packages/core/` (2a and 1b own it), `packages/browser/`. A missing core piece is reported, not added here.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2b.1 | Tree provider on the core derivation: scopes with arc icons, papers with REF iconPath, getParent for papers, lazy children | — | M · test-writer, then implementer | A14 | [ ] |
| 2b.2 | Reveal both ways: tree click → queued `reveal`; webview selection → tree reveal + mark | 2b.1 | M · test-writer, then implementer | A15, A16 | [ ] |
| 2b.3 | Node file listing and description adapter wired at the composition root | — | M · implementer | A8 | [ ] |
| 2b.4 | Finish, commit | 2b.1–2b.3 | `finish`, `commit-splitter` | gate passes | [ ] |

## 2b.1 — Tree
- **Do:** `ui/library/libraryTreeDataProvider.ts` consumes the core tree derivation; REF light/dark SVGs generated from core like `ui/arcMarkIcons.ts`; paper ids distinct from folder ids. Split the provider if it passes 200 lines.
- **Test first:** children order, scope counts, getParent of a paper.

## 2b.2 — Reveal
- **Do:** queue host→webview messages in `listWebviewPanel.ts` until `_webviewReady` (today `_post` drops them); paper click opens the list tab and posts `reveal`; selection message reveals and marks the paper node.
- **Test first:** a reveal posted before ready arrives after ready.

## 2b.4 — Finish, commit
- Gate failures in core files belong to 2a or 1b: report them, do not fix them.
