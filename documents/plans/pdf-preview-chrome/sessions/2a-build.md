# Session 2a — Host: build state and data for the footer

- **Wave:** 2, runs together with 2b and 2c
- **Starts from:** 1a and 1b committed
- **Ends with:** A2, A3, A4 (Ctrl+S), A5, A11 (Compare/Mark); problem list and limit counts reach the webview
- **Commit:** yes
- **Research:** research/preview.md, research/writing-core.md
- **Owns:** `packages/vscode/src/writing/build/**`, `packages/vscode/src/writing/typst/node/registerTypstBuild.ts`, `packages/vscode/src/writing/preview/**` except `preview/citations/`, `core/src/writing/problems/` (new), `core/src/writing/limit/` (new), `core/src/reader/dom/preview/header/{options,logs}*`, `core/src/reader/dom/preview/footer/status*`, their tests
- **Must not touch:** protocol and contracts (1b), `preview/citations/` (2c), footer cites/limit/checks slots (2b)

Wave rules: plan.md §6. Edit only the paths under **Owns**; report anything else to the main thread. Commit with an explicit list of these files.

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2a.1 | Stale (D7) and "Compiled N ago": host tracks edits after last build; Recompile muted / amber dot / spinning; footer status | — | M · test-writer, then implementer (sonnet) | A2 | [ ] |
| 2a.2 | Options menu: auto compile honoured by both save listeners and Typst live compile; engine list (D5) via pick-compiler path; Ctrl/Cmd+S recompiles | — | M · test-writer, then implementer (sonnet) | A3, A4 | [ ] |
| 2a.3 | Logs button with warning+error count (reuse `logs/`); Compare/Mark/Checks `runCommand` handlers | 2a.1 | M · test-writer, then implementer (sonnet) | A5, A11 commands | [ ] |
| 2a.4 | Core `writing/problems/` (ordered list, SyncTeX points, Typst cite targets) and `writing/limit/` counts (`countWords`, `collectProjectSources`, `paperBody`); host sends both after each build; finish, commit | 2a.1 | M · test-writer, then implementer (sonnet); `finish`, `commit-splitter` | unit tests, message in host test | [ ] |
