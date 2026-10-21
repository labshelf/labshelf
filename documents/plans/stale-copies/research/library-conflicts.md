sha: c078dbc
files: packages/core/src/library/conflicts/**, packages/core/src/writing/merge/**, packages/core/src/reader/sidecar/**, packages/vscode/src/library/conflicts/**, packages/terminal/src/ui/app/conflicts/**, documents/contracts/sync.md, documents/contracts/library-format.md
source: scout

## Detection

- Conflict copies are detected by name only (`library/conflicts/conflictNames.ts:11-31`: Syncthing, Nextcloud, Dropbox, rclone). Google Drive, OneDrive and iCloud are not matched (TRAP header).
- `scanLibraryConflicts` (`writing/merge/node/libraryConflictScan.ts:11-27`) scans papers, then projects, then Spaces. It runs at open and before every reindex batch (`library/externalChange/changeBatch.ts:16-27`).
- The VS Code watcher is `vscode/src/storage/data/externalChangeWatcher.ts`, with a 1 s debounce. Project folders registered outside the library are not watched.
- The terminal has a startup scan, batch scans and a `:conflicts` overlay (`terminal/src/ui/app/conflicts/conflictOverlay.ts`).
- The browser has no conflict code.

## Projects

- `projectConflictScan.ts` (`seedBases` :42-53) and `projectCopyMerge.ts:48-81` (`mergeProjectCopies`) merge every copy when a base exists, then write the single copy as the base.
- Base store: `IMergeBaseStore {read(projectId, path), write(...)}` (`mergeBaseStore.ts:10-14`). It lives at `<state>/libraries/<key>/merge-bases/<projectId>/<path>` (`library/node/deviceState/deviceLocalLayout.ts:65`). A base is written only on first sight and after a single-copy merge (`sync.md`).
- `textMerge.ts:26-47` (node-diff3, markers `<<<<<<< local` / `>>>>>>> <label>`) is injected into the collab mirror too.

## User prompt

- VS Code shows "N files have conflicting copies" with a Resolve button (`vscode/src/library/conflicts/conflictNotifier.ts`, `conflictHandling.ts:25-31`), then a quick pick for each copy: Keep mine, Keep the other, Keep both (`conflictChoices.ts`, `conflictWalk.ts`).
- Resolution code: `library/conflicts/node/conflictResolution.ts:30-54`. Copy shape: `ConflictCopy {owner, original, copy, tool}` (`conflictCopy.ts`).

## Sidecars

- `mergeSidecars` (`library/conflicts/sidecarMerge.ts:24-33`): the newer file by mtime wins whole annotations by id, theme and reading. The fold is in `node/sidecarConflictMerge.ts:59-72`. A deleted annotation comes back, and a newer edit of one annotation in the older file is lost.
- `Annotation` (`model/annotation.ts:20-30`) has `createdAt` and `updatedAt`, with no deletion field. `normalizePaperData` (`reader/sidecar/paperData.ts`) drops unknown top-level keys. All apps write the same bytes (`library-format.md:277-299`).
- `PaperDataStore.deleteAnnotation` (`reader/sidecar/paperDataStore.ts:135-143`) is the only place that deletes an annotation.
- The contract sentence "A deleted annotation may come back" is at `library-format.md:314`.

## Tests

- core: `__tests__/library/conflicts/**`, `__tests__/writing/merge/**`, `__tests__/reader/sidecar/**`.
- vscode: `__tests__/library/conflicts/**`.
- terminal: `__tests__/ui/app/conflicts/**`.
- Fixtures: `__tests__/support/tempDirs` (`makeTempDir`, `listFiles`, `fakeLogger`).
