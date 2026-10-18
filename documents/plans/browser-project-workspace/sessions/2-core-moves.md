# Session 2 — portable VS Code pieces move to core

- **Goal:** the Files tree nodes, checklist sidebar rows, outline nesting, the portable All projects library and the template gallery host live in core, and VS Code imports them from there.
- **Starts from:** plan approved.
- **Ends with:** core exports the pieces below with their tests moved; VS Code behaviour unchanged; `pnpm --filter @labshelf/core test`, `pnpm --filter @labshelf/vscode test` and both typechecks pass.
- **Owns:** `packages/core/src/writing/{projectTree,checklist/sidebar,outline,allProjects/library,templates/host}/`, `packages/vscode/src/writing/{tree,checklist,outline,allProjects,templates}/`, the matching `__tests__/` folders.

Facts with paths and line ranges: `documents/plans/browser-project-workspace/research/core-reuse.md` and `documents/plans/browser-project-workspace/research/browser-runtime.md` (Templates).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | Tree, checklist, outline to core | task | module-splitter (sonnet) | moved, VS Code imports core | [ ] |
| 2.2 | All projects library and gallery host to core | behaviour | implementer (sonnet) | moved behind structural types | [ ] |
| 2.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2.1 — Tree, checklist, outline

- **Goal:** move pure code out of `packages/vscode` without behaviour change.
- **Read only:** `documents/plans/browser-project-workspace/research/core-reuse.md` (Outline, Checklist, Files tree); `packages/vscode/src/writing/tree/projectFilesProvider.ts:1-88`; `packages/vscode/src/writing/checklist/checklistSidebarNodes.ts:1-114`, `checklistRows.ts:1-75`; `packages/vscode/src/writing/outline/nestedSymbols.ts:1-32`, `outlineNodes.ts:1-22`; `packages/core/src/library-ui/sidebarTrees.ts` (snapshot types).
- **Decided:** `core/src/writing/projectTree/projectFileNodes.ts` holds `HIDDEN_NAMES`, the sort (folders first, then `localeCompare`) and main/source marking, returning `SidebarTreeNode`s; the vscode provider maps them to `TreeItem`s. `checklistSidebarNodes` and `checklistRows` move to `core/src/writing/checklist/sidebar/` unchanged. Outline nesting and `currentHeading` move to `core/src/writing/outline/` over `{level,title,line}` (Typst from `scanTypstHeadings`, LaTeX through a level-preserving adapter from `scanLatexSource(text).sections`, since `sourceHeadings` drops the level); vscode wraps results in `vscode.Range`/`DocumentSymbol`. Existing tests move with the code to mirrored paths.
- **Done when:** both packages typecheck and test; no file over 200 lines; every new folder has an `index.ts`.
- **Do not touch:** `packages/browser/`, vscode wiring files named in `documents/plans/browser-project-workspace/research/core-reuse.md` as "stays".

## 2.2 — All projects library and gallery host

- **Goal:** one portable `createProjectLibrary` and gallery host in core that the browser can compose.
- **Read only:** `documents/plans/browser-project-workspace/research/core-reuse.md` (All projects); `packages/vscode/src/writing/allProjects/projectLibrary.ts:1-126`, `projectHostActions.ts:1-65` (TRAP at :44), `projectBuildState.ts:1-36`, `projectRows.ts`; `packages/core/src/writing/allProjects/projectLibraryPort.ts:6-40`; `packages/vscode/src/writing/templates/galleryHost.ts:1-141`, `useTemplate.ts:1-29`.
- **Decided:** core `createProjectLibrary(deps)` in `core/src/writing/allProjects/library/` takes `{data, fs, path, logger, openProject, createProject, openFile, openLabel, onChange}`; host actions (`openProject`, `openFile`, build, preview, open log) are injected functions; `createFile` keeps its escape and exists check; `summariseBuild` works over a structural `{status, problems, finishedAt}` type declared in core; `toProjectRow` moves as is; PDF mtime comes from `fs.stat` of `LibraryFileSystem`. Gallery host and `useTemplate` move to `core/src/writing/templates/host/`; the title prompt stays an injected `askTitle`. VS Code keeps `executeCommand`, `vscode.open`, `desktopCommandsAvailable` and `openLabel: "Open in VS Code"`. Existing tests move and keep passing; add one test that `createFile` refuses an existing name through the core seam.
- **Done when:** both packages typecheck and test; size limits hold.
- **Do not touch:** `packages/browser/`, `core/src/writing/latex/`.
