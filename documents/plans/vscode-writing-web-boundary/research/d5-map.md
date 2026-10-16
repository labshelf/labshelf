sha: 4110b6c
files: packages/vscode/src/writing/**, packages/vscode/src/activation/registration/registerWritingView.ts, packages/vscode/src/extension.ts, packages/core/src/writing/typst/**
source: code-mapper (S3.1), 2026-10-16; decision on TypstBuildResult by the session model

# D5 move map

All paths under `packages/vscode/src/writing/`, tests under `packages/vscode/__tests__/writing/`.

## Moves

| from | to | tests |
|---|---|---|
| build/latexBuilds.ts | build/node/latexBuilds.ts | build/latexBuilds.test.ts → build/node/ (mock path → `src/writing/build/toolchain/node`) |
| build/registerLatexBuild.ts | build/node/registerLatexBuild.ts | none |
| build/toolchain/toolchainSetup.ts | build/toolchain/node/toolchainSetup.ts | build/toolchain/toolchainSetup.test.ts → build/toolchain/node/ |
| build/toolchain/tectonicSetup.ts | build/toolchain/node/tectonicSetup.ts | none |
| typst/typstBuilds.ts | typst/node/typstBuilds.ts | typst/typstBuilds.test.ts → typst/node/; its `typstPreviewPdf` describe → typst/typstPreviewPdf.test.ts |
| typst/typstCompilerHost.ts | typst/node/typstCompilerHost.ts | via registerTypstBuild test mock |
| typst/registerTypstBuild.ts | typst/node/registerTypstBuild.ts | typst/registerTypstBuild.test.ts → typst/node/ (mock path → `.../typst/node/typstCompilerHost`) |
| figures/regenerateFigure.ts | figures/node/regenerateFigure.ts | figures/regenerateFigure.test.ts → figures/node/ |
| check/registerCheckCommand.ts | check/node/registerCheckCommand.ts | check/registerCheckCommand.test.ts → check/node/ |
| versions/registerCompareVersionsCommand.ts | versions/node/registerCompareVersionsCommand.ts | versions/registerCompareVersionsCommand.test.ts → versions/node/ (`jest.mock` of `ensureToolchain` → `src/writing/build/node`) |

`node/index.ts` exports: `build/node`: `registerLatexBuild`, plus `ensureToolchain` re-exported from `../toolchain/node/index.js`. `build/toolchain/node`: `ensureToolchain`. `typst/node`: `registerTypstBuild`. `figures/node`: `registerRegenerateFigure`. `check/node`: `registerCheckCommand`. `versions/node`: `registerCompareVersionsCommand`. Export nothing else unless a test or importer needs it.

## Neutral pieces

- **Core type move (D1, the only core edit):** `TypstBuildResult` moves from `packages/core/src/writing/typst/node/runTypstBuild.ts` to a new neutral `packages/core/src/writing/typst/typstBuildResult.ts`, exported from `packages/core/src/writing/typst/index.ts` (the `@labshelf/core/typst` entry). `runTypstBuild.ts` imports it back and `typst/node/index.ts` keeps exporting it from the new file. No structural copy in vscode.
- `build/buildListener.ts` (new): `BuildListener`, `BuildTrigger`, `FinishedBuild` moved out of `latexBuilds.ts`. `FinishedBuild` imports `TypstBuildResult` from `@labshelf/core/typst` (type-only).
- `build/projectBuilders.ts` (new): `ProjectBuilders = Record<ProjectFormat, { request(projectFolder, "command"): Promise<{status:string}|undefined> }>`, replacing the inline copies in `registerBuildCommand`, `registerCheckCommand`, `versions/buildCurrentPdf.ts`.
- `typst/typstPreviewPdf.ts` (new): `typstPreviewPdf(project, data: Pick<ProjectDataPort,"projectBuildDir">, paths: Pick<PathOps,"join"|"basename"|"extname">)`, replacing `path.join(projectBuildDir(id), parse(main).name + ".pdf")`. Add a test with a dotted main name (`a.b.typ`).
- Stay neutral and unchanged in place: `build/toolchain/{toolchainDeps,pickCompiler,compilerStatusBar}.ts`, `check/checkDiagnostics.ts` (exported from `check/index.ts` as `checkDiagnostics`), `versions/{ComparePanels,compareSides,buildCurrentPdf}.ts`.
- `writing/nodePort/` (new folder: `nodeWritingPort.ts` + `index.ts`): `NodeWritingDeps = { context; host: WritingHost; projects: WritingProjects; figures: ProjectFigures; previews: BuildPreviews; diagnostics: BuildDiagnostics; reader: Omit<ReaderPanelDeps,"logger"|"extensionUri"> }` and `type RegisterNodeWriting = (deps: NodeWritingDeps) => { builders: ProjectBuilders }`. Must not import `activation/`.

## Importer changes

- Barrels: `build/index.ts` drops `registerLatexBuild`, `ensureToolchain`, adds types from `buildListener`/`projectBuilders`. `build/toolchain/index.ts` drops `ensureToolchain`. `typst/index.ts` drops `registerTypstBuild`, adds `typstPreviewPdf`. `figures/index.ts` drops `registerRegenerateFigure`. `check/index.ts` exports `checkDiagnostics` instead of `registerCheckCommand`. `versions/index.ts` drops `registerCompareVersionsCommand`.
- `preview/builtPdf.ts`: `builtPdf(projects: Pick<WritingProjects,"data"|"paths">, project)` calls `typstPreviewPdf(project, projects.data, projects.paths)`. `registerShowPreview.ts`, `registerShowInPreview.ts` widen `projects` to include `paths` and `data`. `builtPdf.test.ts` uses a fake `data.projectBuildDir` instead of the `XDG_CACHE_HOME` env hack; assertions stay.
- `versions/buildCurrentPdf.ts`: shared `ProjectBuilders`, `projects: Pick<WritingProjects,"data"|"paths">`. `build/registerBuildCommand.ts`: shared `ProjectBuilders`.
- `activation/registration/registerWritingView.ts`: drop the imports of the moved registrations, `hostPdfjs` (`pdf/node`) and the figures output channel; add last parameter `registerNodeWriting: RegisterNodeWriting`; `registerBuildAndPreviewCommands` calls `const { builders } = registerNodeWriting({ context, host, projects, figures, previews, diagnostics, reader })` where `builders` is built today; `registerProjectAndFigureCommands` loses `registerRegenerateFigure`. Construction order unchanged.
- `extension.ts`: imports `registerNodeWriting` from `./writing/node/index.js` and passes it to `registerWritingView`. `__tests__/activation/registration/registerWritingView.test.ts` passes a fake registrar returning `{ builders }`.

## registerNodeWriting (`writing/node/registerNodeWriting.ts` + `index.ts`)

1. Create the `LabShelf Figures` output channel, push to `context.subscriptions`. 2. `registerRegenerateFigure({ context, host, figures, output })`. 3. `latex = registerLatexBuild({ context, host, projects, previews, diagnostics })`. 4. `typst = registerTypstBuild({ …, hasPreview: (f) => previews.hasPreview(f) })`. 5. `builders = { latex, typst }`. 6. `registerCheckCommand({ …, builders, pdfjs: hostPdfjs })` (`hostPdfjs` from `../../pdf/node/index.js`). 7. `registerCompareVersionsCommand({ …, builders, pdfjs: hostPdfjs, reader })`. 8. Return `{ builders }`.

## Rules

- Only `extension.ts` imports `writing/node`; `node/` folders may import each other and their feature's neutral files. No neutral file imports any vscode `node/` folder.
- Every directory ≤ 8 source files (`index.ts` excluded); expected max is 8 at `writing/` root (unchanged).
- Not yet read by the mapper: `__tests__/.../preview/typstPreview.test.ts`, `commands/index.ts`. Check them for references to moved files.
