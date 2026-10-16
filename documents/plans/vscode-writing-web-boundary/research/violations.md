sha: a24b122
files: packages/vscode/src/writing/**, packages/vscode/src/continue/**, packages/vscode/src/ui/list/host/projectSource.ts, packages/vscode/src/activation/**, .dependency-cruiser.cjs
source: Explore scout, 2026-10-16

# Violations by class

63 = 34 core/node imports + 27 Node built-ins + 2 no-import-past-index. Paths are under `packages/vscode/src/`.

**Port facts:** `HostAdapters.paths: PathOps` (activation/serviceComposition/hostAdapters.ts:14). PathOps is sep, join, dirname and basename (core/src/library/mutations/context.ts:6). Node gives `paths: path` (activation/node/nodeAdapters.ts:17). Only extension.ts imports activation/node. `IFileSystem` is at core/src/ports/fileSystem.ts:3.

**Node-only types:** ProjectEntry (core writing/project/node/projectFolder.ts:15), LocatedProblem (writing/latex/build/node/locateProblems.ts:7), OpenSources (writing/citations/node/projectSources.ts:8), ProjectVersion (writing/versions/node/listVersions.ts:10), PdfjsLoader (import/node/loadPdfjs.ts:14).

**T (type only):** build/buildDiagnostics, citations/openEditorSources, figures/figureNode, install/installCommand, preview/previewPorts, projectsTreeProvider, versions/compareSides.

**P (node:path only):** ui/list/host/projectSource, build/registerLatexBuild, citations/citationWorkspace, figures/figureTreeItem, latexEditing/project/latexProjectSources, preview/sourceLinks/showSource, typst/tinymist/tinymistMainPin, versions/ComparePanels. **P+T:** mainDocument (31 importers), openProjectMain, preview/buildPreviews. The path members each file uses have not been checked.

**F:** preview/builtPdf (stat, plus path), preview/citations/sourceLineAt (readFile utf8), continue/continueTargets (stat isFile at l.45, plus path, plus latestProjectEdit).

**N(core) (calls core node data functions):** projectStore (listProjects; 36 importers), projectCommands (addExistingFolder, createProject, rootFileNames), projectItemCommands (unregisterProjectFolder), mainCommands (rootFileNames, updateProjectSettings, plus path), readingList/readingListCommands, build/toolchain/toolchainDeps and typst/typstVersionPin (updateProjectSettings), citations/bibliographySync (updateProjectBibliography), figures/projectFigures (readFigureStates), values/projectValues (readProjectValues), values/typstValueFile (valueFilePath, possibly path-only), backlinks/projectBacklinkIndex (projectBacklinks), preview/sourceLinks/projectSynctex (projectBuildDir, readSynctexFile), versions/registerMarkVersionCommand (listVersions, markVersion), continue/projectCursorRecorder (writeProjectCursor).

**N (process or external tool):** build/latexBuilds (runLatexBuild), build/toolchain/tectonicSetup, build/toolchain/toolchainSetup (findExecutable), figures/regenerateFigure (runFigureCommand), check/registerCheckCommand (checkProject), typst/typstBuilds, typst/typstCompilerHost (reads WASM via require.resolve), versions/registerCompareVersionsCommand (comparePdfs, buildMarkedUpDiff, findExecutable).

**Index violations:** continue/projectCursorRecorder.ts:7 imports `../writing/mainDocument.js`, and writing/index.ts does not export mainPathIn or owningProject. core writing/versions/node/buildMarkedUpDiff.ts:7 should import from `../../latex/build/index.js`, which already exports it.

**Tests that import violators directly (13):** __tests__/continue/{continueTargets,projectCursorRecorder}, ui/list/host/projectSource, support/valueFixtures.ts, writing/{mainDocument, build/latexBuilds, check/registerCheckCommand, preview/builtPdf, typst/registerTypstBuild, typst/typstBuilds, typst/typstVersionPin, versions/registerCompareVersionsCommand, versions/registerMarkVersionCommand}.
