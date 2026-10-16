sha: 25a7770
files: packages/vscode/src/writing/**, packages/vscode/package.json, packages/core/src/reader/**, packages/core/src/writing/latex/**, packages/core/src/writing/typst/**, documents/contracts/reader-host.md
source: two Explore scouts, 2026-10-16; Writing view, Builds and Preview re-scouted 2026-10-16 after session 1

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
- One `ReaderPanel` per project, key `preview:<folder>` (`preview/buildPreviews.ts`); `shown` maps folder → absolute root shown, but `show()` always sets the main root, and problems/typstCites/synctex closures and the `finished()` reload follow only the main root.
- `ReaderPanel.createOrShow` on an existing key only reveals; `pdfUri` and `rootDir` (localResourceRoots) are read once at creation. The reader's `reloadDocument` re-reads the same `assets.pdfUrl` (`core/src/reader/dom/session/documentReload.ts`) keeping page, offset and zoom.
- `registerShowPreview` / `registerShowInPreview` use the main root only; a command-triggered build opens the preview when none is open.
- Toolbar (`core/src/reader/dom/chrome/toolbar.ts`) has fixed buttons, no slot. Forward/inverse search LaTeX only.
- Test support: `__tests__/support/writingFixtures.ts` (`fakeHost, fakeProjects, readyEntry, commandHandler, openInEditor`); window mock has `onDidChangeActiveTextEditor` (`_fireActiveEditorChange`) but no `tabGroups`; `workspaceState` faked inline.
