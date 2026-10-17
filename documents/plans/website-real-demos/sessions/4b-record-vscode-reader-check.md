# Session 4b — VS Code reader and check clips

- **Goal:** record the two VS Code clips session 4 left: `reader` and `check`.
- **Starts from:** session 4 committed: `website/tools/record/vscode.mjs` and `website/tools/record/vscode/` record `library`, `add-paper`, `cite-completion` and `preview` into `website/media/vscode/`.
- **Ends with:** `website/media/vscode/{reader,check}` exist, each as `.mp4`, `.webm` and `.jpg`, each at most about 3 MB.
- **Owns:** `website/tools/record/vscode/`, `website/media/vscode/`, plus the core reader fix of 4b.1 if one is needed.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4b.1 | A new highlight is drawn in the VS Code reader | behaviour | `diagnose` (sonnet), then `implementer` | a failing test, then the fix | [ ] |
| 4b.2 | Record `reader` and `check` | — | main thread | two clips | [ ] |

## How to run the recorder

- `node website/tools/record/vscode.mjs "<scratch>/vscode/vscode-darwin-arm64-<ver>/Visual Studio Code.app/Contents/MacOS/Code" <scratch> reader check`, outside the sandbox. Get the binary with `@vscode/test-electron`'s `downloadAndUnzipVSCode({ cachePath: "<scratch>/vscode" })`, the library with `node website/tools/fetchDemoLibrary.mjs <scratch>/lib`, and build first with `pnpm --filter @labshelf/vscode build`.
- The window is a test-electron copy, stopped by its PID only. Never run `/Applications/Visual Studio Code.app`; never `pkill`/`killall` by name. Ask the user before the first launch.
- A failed take leaves `<scratch>/failed-<clip>.png`.

## 4b.1 — Highlight not drawn

Found 2026-10-17 in the isolated host: in "Chain-of-Thought Prompting…" (`wei2022chainofthought`, page 3), selecting "Chain-of-thought prompting has several … in language models." and clicking the bubble's "Highlight yellow" saves the highlight to `.research/papers/wei2022chainofthought/data.json` (it also appears in the preview's citation card), but no yellow is drawn on the page; the selection just clears. Find the cause in the reader's highlight rendering (`packages/core/src/reader/`) and fix it with a test. If the cause is the recorder (it drives the page under a CDP viewport override of 1440×900 at scale 2, `website/tools/record/vscode/workbench.mjs`), fix the recorder instead.

## 4b.2 — Record

- `reader` is scripted in `website/tools/record/vscode/readerTake.mjs`: highlight one sentence, "Copy with citation" another, hover the Wiegreffe reference. Rerun it once 4b.1 is fixed and check the yellow shows.
- `check` (`writingTakes.mjs`) timed out waiting for `.markers-panel .monaco-list-row` after "Research: Check Before Submitting"; in an earlier manual run the Problems panel opened with the results within 10 s. Find why from the failure screenshot (the palette may not have matched, or focus was in the preview webview) and fix the take.
- Then: `check` on the Owns; append a log line; delete this file; commit the Owns.
