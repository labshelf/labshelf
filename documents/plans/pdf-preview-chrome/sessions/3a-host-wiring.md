# Session 3a — Host wiring: preview ports and roots

- **Wave:** 3, runs together with 3b
- **Starts from:** wave 2 committed
- **Ends with:** every 1b request has a host handler, and `previewRoots` carries options, problems, cites, words, limits and checks (A3, A7, A9–A13 host side); Compare / Mark / Checks commands run (A11)
- **Owns:** `packages/vscode/src/writing/preview/previewPorts.ts`, `packages/vscode/src/writing/preview/index.ts`, `packages/vscode/src/writing/preview/projectPreview/**`, `packages/vscode/src/writing/preview/roots/**`, `packages/vscode/src/activation/registration/registerWritingView.ts` (only if a dependency must be passed in), their tests
- **Research:** none
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. Wave-2 functions are used as the seams S5–S10 state; a mismatch goes back to the main thread, not into their files.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3a.1 | Port handlers | behaviour | implementer (sonnet) | port tests pass | [ ] |
| 3a.2 | Roots fields and resend triggers | behaviour | implementer (sonnet) | roots tests pass | [ ] |
| 3a.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 3a.1 — Port handlers

- **Goal:** `createPreviewPorts` implements `runCommand`, `setAutoCompile`, `setEngine`, `setIncludeOnly`, `setCheckLimits`, `fixCitation`, `exportProject`, and `lookupCitation` returns entries with fixes.
- **Read only:** `core/src/reader/host/ports.ts:26-58`; `vscode/src/writing/preview/previewPorts.ts:1-30`; `vscode/src/writing/preview/projectPreview/previewPanelSource.ts:30-60`; `vscode/src/writing/preview/roots/writingActions.ts:1-82`; plan §6 Seams S6–S10.
- **Decided:** `runCommand(id)` → `vscode.commands.executeCommand("labshelf.writing." + id, projectEntry)` (ids match the commands). Each handler acts on the panel's project and shown root; after `setAutoCompile`, `setEngine`, `setIncludeOnly`, `setCheckLimits` the roots are resent (3a.2). `lookupCitation` = 2f's lookup then `withCitationFixes`. Handlers log failures with project folder and root.
- **Done when:** a test per handler with fakes; vscode `writing/preview` tests pass.
- **Do not touch:** the wave-2 folders (`build/options`, `build/node`, `preview/problems`, `preview/limits`, `preview/citationFixes`, `preview/citations`, `export`, `preview/stale`).

## 3a.2 — Roots fields

- **Goal:** `previewRootsMessage` fills `options`, `pdfProblems`, `cites`, `words`, `wordLimit`, `countUpTo`, `checks`, and is resent when any of them changes.
- **Read only:** `vscode/src/writing/preview/roots/previewRootsMessage.ts:1-45`; `vscode/src/writing/preview/projectPreview/buildPreviews.ts:100-157`; `core/src/reader/previewProtocol.ts:100-140`; plan §6 Seams S5–S8.
- **Decided:** per built root: `pdfProblemsOf` (S5) and `rootWords` (S6); project level: `buildOptions` (S7) plus `includeOnly` from `IncludeOnlyState.option` (S8), `check.words`/`check.countUpTo`, `CheckCounts.get`. Resend on: build end, `onAutoCompileChange`, labshelf.yaml reload, `CheckCounts.onChange`, editor focus change (includeOnly file). Counting runs after the build, never per keystroke.
- **Done when:** `previewRootsMessage` tests for each field and absence; a buildPreviews test that a check run resends; tests pass; files ≤ 200 lines (split `buildPreviews.ts` by responsibility if it passes).
- **Do not touch:** as 3a.1.
