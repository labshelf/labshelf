sha: b58f5b5
files: packages/vscode/src/writing/**, packages/vscode/package.json, packages/core/src/reader/**, packages/core/src/writing/latex/**, packages/core/src/writing/typst/**, documents/contracts/reader-host.md
source: two Explore scouts, 2026-10-16

# Current state of writing view, builds and preview

## Writing view
- View `labshelf.writing` in container `labshelfContainer` (package.json:337-359), created in `vscode/src/activation/registration/registerWritingView.ts:142-150`.
- `projectsTreeProvider.ts`: root = `projects.list()`; ready project is collapsible, label = id, description = main, click runs `labshelf.writing.openMain`; children = figures + one reading-list node. Broken projects show a warning. contextValue `labshelfProject[External]` / `labshelfProjectBroken[External]`.
- Context keys today: only `labshelf.libraryLoaded`, `labshelf.driveConnected`.

## Workspace independence
- Providers resolve the project from the document path via `owningProject` (`writing/mainDocument.ts`). `workspaceFolders` appears only in `build/latexWorkshopNotice.ts:20`. No `findFiles`. `RelativePattern` only on project or library folders.
- Not read directly: latexEditing, bibliography, label-diagnostics providers.

## Builds
- Core builders take `main` as a parameter (`runLatexBuild.ts:15-20`, `runTypstBuild.ts:19-24`); callers fix it to `project.main` (`vscode/src/writing/build/node/latexBuilds.ts`, `typst/node/typstBuilds.ts`).
- LaTeX aux/log/synctex go to `projectBuildDir(id)`, files named by main basename; on success the PDF is copied next to main. Typst live compile writes `<buildDir>/<base>.pdf` (`typstPreviewPdf.ts`).
- Same basename in two folders collides. All state (LatexBuilds queue, BuildPreviews panels/problems/states/synctex, diagnostics, builtPdf) is keyed by project folder. A newer build request aborts the running one.
- No persisted build state; `BuildPreviews.states` is in memory and deleted on success. No per-project sync status.
- Compile triggers: LaTeX on save (debounced), Typst on save and live while a preview is open; command `labshelf.writing.build`.

## Errors
- LaTeX: `parseTexLog(log, engine)` → `BuildProblem {severity error|warning|info, message, hint?, file?, line?}`; no raw text. Located into `LocatedProblem`.
- Typst: structured `TypstDiagnostic` → `LocatedProblem {severity error|warning, message, file, line?}`; hints dropped; not published to Problems when Tinymist is installed.

## Preview / reader
- Preview = `ReaderPanel` WebviewPanel keyed `preview:<folder>` (`buildPreviews.ts:80-92`), core reader with `preview: true` (`protocol.ts:54`).
- `preview` flag used only by sourceSync dblclick and citation lookup/clicks. Annotations rejected by `writing/preview/previewStore.ts`. Build banner driven by `setBuildStatus`.
- Toolbar (`core/src/reader/dom/chrome/toolbar.ts:30-36`) fixed buttons: sidebar, back, forward, find, theme, cheatsheet; no slot.
- Forward search: `labshelf.writing.showInPreview` → `revealInPreview`. Inverse: dblclick → `showSource` → `openSourceLine`. LaTeX only; Typst returns unsupported.
- No Monaco/CodeMirror anywhere. No custom editor for `*.pdf`.
