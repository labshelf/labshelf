# Session 3 — First run, sync guide, move library, conflict UI

- **Goal:** a new user picks a synced folder in one step, can move the library later, learns how to sync, and resolves conflict copies in VS Code and the terminal.
- **Starts from:** session 2 committed (conflict scan and resolutions exist in `core/src/library/conflicts/`).
- **Ends with:** A4 (UI part), A6 of plan `folder-sync`.
- **Owns:** `packages/core/src/library/node/location/**`, `packages/core/src/library/syncGuide/**`, `packages/core/src/ui/dom/syncGuide/**`, their tests; `packages/vscode/src/storage/paths/libraryLocation.ts`, `packages/vscode/src/activation/libraryLifecycle/libraryRootController.ts`, `packages/vscode/src/activation/registration/registerLibraryCommands.ts`, new `packages/vscode/src/library/{firstRun,moveLibrary,conflicts,syncGuidePanel}/**`, `packages/vscode/src/extension.ts`, `packages/vscode/package.json`; `packages/terminal/src/main.ts`, `packages/terminal/src/cli/**`, `packages/terminal/src/ui/app/**` (conflict segment and overlay); `documents/apps/{vscode,terminal}.md`, `documents/product.md`.

Context: a library is a folder the user's sync tool syncs; LabShelf calls no cloud API. Facts: `documents/plans/folder-sync/research/library-setup.md`. Design: `research/first-run-design.md`; move rules: `research/folder-rules-decisions.md` ("First run and moving").

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Core: detect sync folders, inspect a folder, move a library | behaviour | implementer (sonnet) | tests | [ ] |
| 3.2 | Sync guide content and DOM component | behaviour | main thread: `ui-design` skill, then implementer (sonnet) | guide renders | [ ] |
| 3.3 | VS Code: first run, move, guide panel, conflicts | behaviour | implementer (sonnet) | A6, A4 UI by hand | [ ] |
| 3.4 | Terminal: first run, `move`, `sync-help`, conflicts | behaviour | implementer (sonnet) | tests for CLI parsing | [ ] |
| 3.5 | Docs | task | `doc-keeper` (sonnet) | app docs updated | [ ] |
| 3.6 | Check, commit | — | `check` on Owns, `git commit` | gate passes | [ ] |

3.1 and 3.2 in parallel; 3.3 and 3.4 in parallel after both; then 3.5.

## 3.1 — Core: detect sync folders, inspect a folder, move a library

- **Goal:** `detectSyncFolders`, `inspectLibraryFolder` and `moveLibrary` in `core/src/library/node/location/`.
- **Read only:** `research/first-run-design.md` (detection), `research/folder-rules-decisions.md` (moving), `core/src/library/layout.ts` (`markerDirs`, `requiredDirs`), `core/src/library/node/sharedConfigFile.ts`, `core/src/library/node/atomicWrite.ts`, `core/src/hash/contentHash.ts`.
- **Decided:** env and home are injected (tests use temp dirs, never the real home). `moveLibrary` is a data-loss path: tests first for same-device rename, cross-device copy+verify+delete, failure mid-copy (source intact, partial target removed), refusal cases. Log every move and failure through `ILogger`.
- **Done when:** tests pass; core typecheck.

## 3.2 — Sync guide content and DOM component

- **Goal:** the "How to sync between computers" guide as runtime-neutral data (`core/src/library/syncGuide/`) and a DOM component (`core/src/ui/dom/syncGuide/`).
- **Steps:** main thread runs the `ui-design` skill on the guide layout from `research/first-run-design.md` ("Sync guide"), then an implementer builds it with core tokens and icons, product vocabulary, no emoji.
- **Done when:** the component renders in a headless page; no test (UI).

## 3.3 — VS Code: first run, move, guide panel, conflicts

- **Goal:** the VS Code flows of `research/first-run-design.md`.
- **Read only:** that entry, `research/library-setup.md` (VS Code first run), `vscode/src/storage/paths/libraryLocation.ts:13,53-100`, `vscode/src/activation/libraryLifecycle/libraryRootController.ts`, `vscode/src/activation/registration/registerLibraryCommands.ts:44`, `vscode/src/extension.ts:115-150`, the 3.1 and 3.2 exports, the session 2 conflict scan/resolution exports.
- **Decided:** commands `labshelf.configureLibrary` (reused), `labshelf.moveLibrary` ("Move Library…"), `labshelf.syncGuide` ("How to Sync Between Computers"), `labshelf.resolveConflicts` ("Resolve Conflicting Copies"). The guide panel is host glue around the core component. Delete `runLibrarySetupWizard` and whatever it alone used.
- **Done when:** vscode typecheck + test; user checks the flows by hand.

## 3.4 — Terminal: first run, `move`, `sync-help`, conflicts

- **Goal:** the terminal flows of `research/first-run-design.md`.
- **Read only:** that entry, `research/library-setup.md` (terminal first run), `terminal/src/main.ts:21-72`, `terminal/src/app/config.ts:51`, `terminal/src/cli/usage.ts`, `terminal/src/ui/app/drawing/status.ts`, the 3.1/3.2 data exports, the session 2 conflict exports.
- **Decided:** `DEFAULT_LIBRARY` becomes `~/LabShelf`; tests for argument parsing of `move`, `sync-help`, `conflicts`.
- **Done when:** terminal typecheck + test.
