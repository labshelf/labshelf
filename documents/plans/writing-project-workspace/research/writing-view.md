sha: 632d371
files: packages/vscode/package.json, packages/vscode/src/activation/registration/registerWritingView.ts, packages/vscode/src/writing/**, packages/vscode/__mocks__/vscode/**
source: one Explore scout, 2026-10-16, session 4 start

# Writing side-bar view

- `package.json:359-363`: view `{id:"labshelf.writing", name:"Writing"}` in `labshelfContainer`, no `when`; viewsWelcome 383-384 (New project / Add existing folder). view/title 408-448: closeProject (`labshelf.writing.projectOpen`, navigation@0), newProject, addExistingFolder, refresh. view/item/context 475-531: project items match `viewItem =~ /^labshelfProject(External)?$/`; figures `labshelfFigure[Stale]` (regenerateFigure); reading list `labshelfReadingList`, `labshelfReadingPaperAdded`.
- Context keys `labshelf.writing.projectOpen` and `labshelf.writing.inProject` are set only in `writing/session/projectSession.ts:101-115`.
- `activation/registration/registerWritingView.ts` (182 lines) builds WritingProjects, ProjectFigures, ProjectBacklinkIndex, ProjectReadingLists, `new WritingTreeProvider(projects, figures, readingLists)` (l.160), `createTreeView("labshelf.writing")` (l.168), `watchFigureFiles`. `registerProjectSession` (l.108) returns the session but it stays local to `registerBuildAndPreviewCommands`.
- `ProjectSession`: `project: ReadyProject | undefined`, `open(entry)`, `close(): Promise<boolean>`, `dispose()`; no open/close event. Restores the saved project on `projects.onDidChange`.
- `writing/projectsTreeProvider.ts` (73 lines): `WritingNode = ProjectEntry | FigureNode | ReadingNode`; a ready project's children are figures + a reading-list node. Imported by `writing/index.ts:10` and registerWritingView only.
- `ProjectFigures`: `children(project): Promise<FigureNode[]>`, `refresh()`, `onDidChange`. `figureTreeItem(node, paths)`. Reading-list tree-only exports: `readingListChildren`, `readingTreeItem`, `ReadingListNode`, `ReadingNode` (`readingList/readingListNodes.ts`).
- Build output is outside the project: `projectBuildDir(id)` = `<cacheDir>/builds/<settings.id>` (core `project/node/projectBuildDir.ts`). `ReadyProject = {kind:"ready", folder, location, settings, main?}`.
- `writing/` has 6 source files directly; `writing/tree/` does not exist.
- Tests: `__tests__/writing/projectsTreeProvider.test.ts` (`fakeProjects`, `readyEntry` from `__tests__/support/writingFixtures.ts`), `__tests__/writing/figures/figureWatchers.test.ts` (`_fileWatchers`, `_fire`). Mock `__mocks__/vscode/api/workspace.js`: `fs` readFile real, others jest.fn; `readDirectory` returns []; `RelativePattern` and `createFileSystemWatcher` mocked.
- `initialSize`: not in `@types/vscode` 1.120 — skip.
