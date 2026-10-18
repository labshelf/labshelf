sha: 7c2715b7
files: packages/core/src/writing/**, packages/core/src/library-ui/**, packages/vscode/src/writing/{outline,checklist,tree,sidebar,allProjects,citations}/**
source: Explore scout, 2026-10-18

## Outline
- `scanTypstHeadings(text)` (core/src/writing/typst/source/typstHeadings.ts:47) → `{level,title,line}[]`. LaTeX: `scanLatexSource(text).sections` (core/src/writing/latex/source/scan/commands/scanSections.ts; `SectionFact` level -1..5, title, range). `sourceHeadings(format,text)` (core/src/writing/backlinks/sourceHeadings.ts:13) drops the level.
- Nesting and "current heading" are vscode-only but pure: vscode/src/writing/outline/nestedSymbols.ts:1-32 (each heading runs to the next of same or higher level), outlineNodes.ts:1-22 (`currentSymbol`: deepest section holding the cursor; later sibling wins at a boundary). Wrapped in vscode.Range/DocumentSymbol.

## Checklist
- Core: `buildChecklist(input, "kind"|"section")` (core/src/writing/checklist/buildChecklist.ts:120, input :12-22), `readChecklistSignals(ProjectReadContext, readyProject)`.
- vscode-only but imports only core types + PathOps: vscode/src/writing/checklist/checklistSidebarNodes.ts:1-114 (`checklistSidebarNodes({paths,checklist,grouping,pageCount,reading,isExpanded})` → `{nodes,items,groups}`; By kind order References, TODOs, Figures, Reading, Pages, My items; folded "N read" row; tone dots) and checklistRows.ts:1-75 (`itemKey`, `itemRow`, `pagesHead`).
- vscode wiring stays: openProjectSignals.ts, checklistView.ts, checklistMemory.ts, registerChecklistView.ts.

## Files tree
- vscode/src/writing/tree/projectFilesProvider.ts:1-88: `HIDDEN_NAMES` {.git, .labshelf}; folders first then `localeCompare`; main file gets description "main"; a non-main source with the project's extension gets contextValue `labshelfProjectSource` ("set as main"). Icons: core `fileIcon(name)` in core/src/library-ui/sidebarTrees.ts.
- Snapshot types in core: `ProjectTreeView`, `SidebarTreeNode`, `SidebarProjectTree`, `SidebarOpenProject` (core/src/library-ui/sidebarTrees.ts). Renderer: core/src/library-ui/dom/sidebar/sidebarOpenProject.ts. vscode builds it in vscode/src/writing/sidebar/projectTreeMirror.ts (walks TreeDataProviders; vscode-bound).

## All projects

The library lives in `packages/core/src/writing/allProjects/library/`; VS Code composes it in `packages/vscode/src/writing/allProjects/projectLibrary.ts`.

## Citations
- core/src/writing/citations/: `partialKeyStart(format, linePrefix)`, `scanCitationKeys`/`citedKeys`, `LATEX_CITE_COMMAND`, `citationSnippet`, `papersByCiteKey`, `pageArgumentContext`.
- vscode/src/writing/citations/citationCompletion.ts:1-40: item label citeKey + year, detail title, filterText "key title authors", sortText `0key`.
