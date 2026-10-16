# Session 2j — Build status: check and commit

- **Goal:** The finished build-status work (stale state, `builtAt`, logs button) passes the gate and is committed.
- **Starts from:** the stale tracker, `setBuildStatus` extension and logs button are implemented and tested but uncommitted in the worktree
- **Ends with:** the files below committed. **A2** Recompile is muted when current, full colour with an amber dot after a source save, spinning while building; the footer says Compiled N ago / Source changed / Compiling…. **A5** Logs button shows the warning+error count; its menu lists entries and opens the source line or the raw log. (Host and header-piece side; the composition is 3a and 3b.)
- **Owns:** `packages/core/src/reader/host/hostController.ts`, `packages/vscode/src/writing/preview/projectPreview/**`, `packages/vscode/src/writing/preview/stale/`, `packages/core/src/reader/dom/preview/header/logs/`, `packages/core/src/reader/dom/styles/preview-logs-button.css`, their tests

Commit file list: `packages/core/src/reader/host/hostController.ts`, `packages/core/__tests__/reader/host/previewMessages.test.ts`, `packages/vscode/src/writing/preview/stale/**`, `packages/vscode/src/writing/preview/projectPreview/buildPreviews.ts`, `packages/vscode/__tests__/writing/preview/{stale/**,projectPreview/buildPreviews.test.ts,typstPreview.test.ts}`, `packages/core/src/reader/dom/preview/header/logs/**`, `packages/core/src/reader/dom/styles/preview-logs-button.css`, `packages/core/__tests__/reader/dom/preview/header/logs/**`.

Seams in these files: `hostController.setBuildStatus(state, errors, { stale?, builtAt? })` (S1); `mountLogsButton(slot, { post }): { setRoots(roots) }` (S3). `BuildPreviews.dispose()` exists; session 3a pushes `previews` to `context.subscriptions`. Session 3b imports `preview-logs-button.css` in `preview.css` and calls `mountLogsButton(header.slots.logs, …)`. The badge uses `--ls-error`/`--ls-warning` fill on `--ls-reader-bg` text; 4a checks it.

If a test unrelated to these files fails (for example `pdfProblemsOf.test.ts` from the problems work), leave it out of the commit and report it.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2j.1 | Check, commit | — | `check` on Owns, `git commit` of the file list above | gate passes | [ ] |
