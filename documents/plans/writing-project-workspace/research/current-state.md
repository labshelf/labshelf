sha: 080f74b
files: packages/vscode/src/writing/**, packages/vscode/package.json, packages/core/src/reader/**, packages/core/src/writing/latex/**, packages/core/src/writing/typst/**, documents/contracts/reader-host.md
source: two Explore scouts, 2026-10-16; Writing view, Builds and Preview re-scouted after session 1; Errors and Preview / reader re-scouted at session 3 start

# Current state of writing view, builds and preview

## Writing view
- View `labshelf.writing`, wired in `vscode/src/activation/registration/registerWritingView.ts` (160 lines): `WritingProjects` (`writing/projectStore.ts`, loads async via `reload()`), tree, `registerBuildAndPreviewCommands` (BuildPreviews, `registerNodeWriting` → `{builders, buildRootOf}`).
- `labshelf.writing.openMain` (`writing/projectItemCommands.ts:33`, also used by the tree item and after create/add in `projectCommands.ts`) calls `openProjectMain(paths, entry)` → `vscode.open` on the main.
- Context keys: only `labshelf.libraryLoaded`, `labshelf.driveConnected`. `tabGroups` unused anywhere. `src/writing/` holds 8 files directly (at the limit).
## Workspace independence
- Providers resolve the project from the document path via `owningProject` (`writing/mainDocument.ts`). `workspaceFolders` appears only in `build/latexWorkshopNotice.ts:20`. No `findFiles`. `RelativePattern` only on project or library folders.
- Not read directly: latexEditing, bibliography, label-diagnostics providers.

## Builds
- Core builders take `main` as a parameter; callers pass the root from `buildRootOf(folder, main, file)` (core `project/roots/node/buildRootOf.ts`, reads every .tex/.typ per call) — see `build/registerBuildCommand.ts:20-30`.
- `ProjectBuilders` (`build/projectBuilders.ts`) = per format `request(projectFolder, root, "command")`. A newer request for the project cancels the running compile.
- LaTeX output in `<projectBuildDir(id)>/<rootBuildFolder(root)>/`, PDF copied next to the root file. Typst live PDF at `<projectBuildDir(id)>/<rootBuildFolder(root)>/<base>.pdf`. `builtPdf(projects, project, root)` returns the path if it exists; no staleness check exists anywhere.
- Build state (problems, states, typstCites, synctex) keyed by absolute root path. Triggers: LaTeX on save, Typst on save and live while a preview is open; command `labshelf.writing.build`.
## Errors
- LaTeX: `parseTexLog(log, engine)` → `BuildProblem {severity error|warning|info, message, hint?, file?, line?}`; no raw text. Located into `LocatedProblem`.
- Typst: structured `TypstDiagnostic` → `LocatedProblem {severity error|warning, message, file, line?}`; hints dropped; not published to Problems when Tinymist is installed.

## Preview / reader
- Boot flag `ReaderBootParams.preview: boolean` (protocol.ts:54, `PROTOCOL_VERSION = 4`), set by `ReaderPanel` when preview ports are passed (vscode/src/pdf-viewer/ReaderPanel.ts:141); read in dom/navigation/sourceSync.ts:21 and dom/hover/citations/previewCitations.ts. Only `Toolbar` call site: dom/startup/buildReaderUi.ts:44-52.
- Toolbar (dom/chrome/toolbar.ts, 140 lines): `iconButton(icon(name), title)` in three `rd-toolbar-group`s; no slot. Banner: dom/chrome/buildBanner.ts (`#build-banner`, failed click posts `showBuildProblem`). Tab strip pattern: dom/sidebar/sidebar.ts:15-60 (`rd-tabs`, role=tablist).
- Messages: HostToWebview by `type` (`reloadDocument`, `buildStatus`, `revealPoint`, `showChanges`, `citation`), no host→webview guard; WebviewToHost by `command`, validated by `isWebviewMessage`. Preview shapes and guards in `reader/previewProtocol.ts` (57 lines). Host side: `host/previewMessages.ts` handlers, `PreviewPorts` in `host/ports.ts:24-33`, posts through `postWhenReady` (holds the latest per `type`). Reader side: `dom/startup/hostMessages.ts` one `host.on` per message.
- VS Code: `preview/buildPreviews.ts` keeps `problems` per absolute root (set in `finished()` before the shown check), `states`, `shown`; `revealSource(project,file,line)` → `controller.revealPoint`. `preview/previewPorts.ts` implements ports; inverse search in `sourceLinks/showSource.ts`; Typst lookups are `unsupported`.
- Raw log: not carried by `FinishedBuild`; it is `<projectBuildDir(id)>/<rootBuildFolder(root)>/<base>.log` (runLatexBuild.ts:47). Typst has none.
- Limits: protocol.ts 206 lines, reader.css 299 (new CSS needs its own file), `core/src/reader/host/` and `dom/startup/` hold 8 files, ReaderPanel.ts 206, buildPreviews.ts 166.
- Icons: refresh, arrow-left, arrow-right, warning, info, external, file-text, loader, list, x, check; no error glyph (warning + `--ls-error`).
- Test support: `__tests__/support/writingFixtures.ts` (`fakeHost, fakeProjects, readyEntry, commandHandler, openInEditor`); core host tests reader/host/{previewMessages,hostController}.test.ts + hostFixture.ts; reader/protocol.test.ts; reader/dom/startup/hostMessages.test.ts; no toolbar test.
