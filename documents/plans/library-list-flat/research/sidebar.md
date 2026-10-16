sha: b7492a43
files: packages/vscode/src/ui/library/*, packages/vscode/src/ui/list/**, packages/vscode/src/activation/registration/registerLibraryTreeView.ts, packages/vscode/src/activation/registration/registerPanelCommands.ts, packages/vscode/src/ui/arcMarkIcons.ts, packages/vscode/build/arcMarks.mjs, packages/vscode/src/core/paperService.ts, packages/core/src/library-ui/derive/tree/*, packages/core/src/library-ui/protocol/*, packages/core/src/library/paperFiles/*, packages/core/src/library/mutations/paperRecordWrite.ts
source: Explore scout + main-thread check, 2026-10-16

# Side bar and VS Code wiring

## Reuse
- `libraryTree({folders, papers})` (core derive/tree/libraryTree.ts:20, exported from `@labshelf/core`): `scopes()` → `{scope, count}[]` (all, unread, reading, done); `children(path)` → `TreeChild[]` subfolders then papers by title; `parentOf(id)` → folder path. `TreeChild = {kind:"folder"; name; path; count} | {kind:"paper"; id; title}`. Folder paths are UI paths rooted at `PAPERS_DIR` ("papers/A/B"). Input `folders` is `FolderTreeNode[]`; check `folderTreeFromSnapshot` output fits.
- `listPaperFiles(fs, paperDir, descriptions, logger)` (core library/paperFiles/listPaperFiles.ts:12) → `PaperFilesState` (`{status:"ready"; files} | {status:"failed"; message}`), port `Pick<LibraryFileSystem,"listDir"|"stat">`. `VscodeFileSystem` (vscode/src/storage/vscodeFileSystem.ts) already implements both: no new listing adapter.
- `describePaperFile(files, name, description, onDisk)` (core library/paperFiles/describePaperFile.ts:10) → new map, `{}` for none, undefined if the name is not on disk. Pure.
- Description write: `PaperFieldsPatch` has no `files`. `writePaperRecord` (core mutations/paperRecordWrite.ts) passes `files` through `rest`, so `writePaperRecord(ctx, {...current, files}, {ownsStatus:false})` writes it with no core change (undefined keeps the key, {} removes it).
- `arcIcons(extensionUri)` (vscode/src/ui/arcMarkIcons.ts) → light/dark Uris of SVGs baked by vscode/build/arcMarks.mjs into out/marks/ (esbuild-bundles one core file, no core build). `STATUS_ARC` in core ui/icons/arcMark.ts maps status → tone/progress. No REF glyph in core: REF is mono text in the `file-ref` token colour (FILE_TYPE_TOKENS in core ui/tokens/colorTokens.ts), baked the same way.

## Protocol (core library-ui/protocol/messages.ts)
- Host→UI `reveal {id}`, `files {id, state}`, `select {id}`. UI→host `paper.selected {id|null}` (deduped, first emission skipped), `paper.files {id}`, `paper.describeFile {id, name, description}` (empty removes), `paper.openFile` / `paper.revealFile` / `paper.copyFilePath {id, name}`. `paper.reveal {id}` = reveal in the OS explorer. All parsed by `parseUiMessage` (SHAPES table, `isEntryName` = one path segment).

## VS Code today
- List webview lives in `ui/list/` (not libraryWebview). `listWebviewPanel.ts` 199 lines: `_post` drops messages until `_webviewReady` (set in `onReady`, which pushes the full state); deferred-message pattern `_citationMapRequested`; `createOrShow(deps, folder?)`, `navigateTo(folder)`; no paper-level reveal.
- `ui/list/host/messageHandler.ts` (74 lines): `parseUiMessage` → `onPaperMessage` → `onFolderMessage`; none of the new messages handled (WARN "message this host does not offer").
- `ui/library/libraryTreeDataProvider.ts` (170 lines): folder-only, own counts (`folderTreeFromSnapshot` + `findNode` + `_countUnder` :131-157, duplicate of `libraryTree`), ids = dirPath or `labshelf:all-papers`, click → `labshelf.openListTab`. `ui/library/` has 6 source files.
- `registerLibraryTreeView.ts` (101 lines): `createTreeView("labshelf.library", …)`, `createLibraryProvider` (:36) from `controller.currentServices()?.library.snapshot`, `syncTreeToPanel(folder)` reveals only when visible.
- Composition: `registerPanelCommands.ts:31` `listPanelDeps(deps, services)` builds `ListPanelDeps` (ui/list/listPanelDeps.ts, optional fields) per open; services has paperService, logger, library.snapshot.
- Tests: `__tests__/ui/libraryTreeDataProvider.test.ts` (`snapshotFromScan`, vscode mock in `__mocks__/vscode/`), `__tests__/ui/listWebviewPanel.test.ts` (posted HostToUi messages), `__tests__/ui/arcMarkIcons.test.ts`; no messageHandler test.

## Risks
- listWebviewPanel.ts is at 199 lines: the outbox queue goes in its own file.
- Tree → panel → selection → tree can loop; guard on the same id.
- Paper rows need their own command; `labshelf.openListTab` takes folder nodes.

## Reveal both ways (2b.2 re-scout, 2026-10-16)
- Protocol: host→UI `reveal {id}` (core flows/revealPaper handles it); UI→host `paper.selected {id|null}` (core reportSelection, mounted in mountLibraryUi). No host→UI message sets a status scope; only `navigate {folder}`.
- `ListWebviewPanel` (ui/list/listWebviewPanel.ts, 199 lines): singleton `currentPanel`; `_post` drops messages while `!_webviewReady`; ready via `onReady` in `_hostContext()`, which runs `_pushState()` then flushes `_citationMapRequested`. `createOrShow(deps, folder?)` navigates an existing panel, so a reveal needs an entry point that does not navigate.
- Host dispatch (ui/list/host/messageHandler.ts): `paper.selected` is unhandled and hits the WARN "message this host does not offer". `ListHostContext` (host/hostContext.ts) holds the callbacks; `ListPanelDeps.onDidNavigate` is the panel→tree seam to copy.
- Tree: items set `labshelf.revealPaper [paperId]` and `labshelf.openListScope [scope]`, neither registered. Paper item id `labshelf:paper:<id>`; provider builds fresh nodes per `getChildren`, `getParent` uses `tree.parentOf`. TreeView handle is local to `registerLibraryTreeView` (`syncTreeToPanel` is the reveal pattern, guarded on `visible`).
- Tests: `__tests__/ui/listWebviewPanel.test.ts` (332 lines) — `open()`, `fire()`, `posted()`; the citation-map block is the queued-until-ready model.
