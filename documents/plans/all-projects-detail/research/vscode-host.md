sha: 18723264 (plus the uncommitted All projects host)
files: packages/vscode/src/writing/**, packages/vscode/package.json, packages/vscode/build/webviews.mjs
source: Explore scout, 2026-10-17

# VS Code writing host

S = `packages/vscode/src/writing`.

- `S/allProjects/`: `index.ts` (24) registers `labshelf.projects.all`; `allProjectsPanel.ts` (53) parses messages with `parseAllProjectsMessage`, runs `serveAllProjects`; `allProjectsHtml.ts` (33); `projectCommands.ts` (18); `projectRows.ts` (28) `toProjectRow(entry, count, modified)` (openItems from the sidebar count text); `projectLibrary.ts` (89) `createProjectLibrary({host, projects, session, source: SidebarProjectsSource})`, caches `projects.data.lastModified(folder)` per folder, clears on `onDidChange`; `open` runs `OPEN_PROJECT_COMMAND` (`labshelf.writing.openProject`, `S/session/registerProjectSession.ts:8`); `files` = `projects.data.listProjectFiles`; `openFile` opens the project then `vscode.open`.
- `webview/main.ts` (13) imports tokens, vscodeHost, base, toast, library-ui, library-list, library-sidebar, all-projects CSS; `webview/allProjectsChannel.ts` (7) wraps `webviewTransport`. Library prefs over webview state: `packages/vscode/src/libraryWebview/webviewChannel.ts`.
- Build: `labshelf.writing.build` (`S/build/registerBuildCommand.ts:11-33`) builds the ACTIVE editor's project: saveAll, then `builders[format].request(folder, root, "command")`.
- `BuildOutcomes` (`S/build/buildOutcomes.ts:7-32`): session-only `Map<folder, {ok, at: Date}>`, `last(folder)`, `onDidChange(folder)`; already injected into `SidebarProjectsSource` (`S/sidebar/sidebarProjectsSource.ts`).
- `RootBuilds` (`S/preview/projectPreview/rootBuilds.ts`): keyed by absolute root path; problems (`LocatedProblem`, severity), error count, `stateOf` building/failed, `builtRoots(folder)`.
- Preview: `labshelf.writing.showPreview` (`S/preview/commands/registerShowPreview.ts:10`), acts on the active project, builds when there is no PDF.
- Log: no command. `openRawLog` is a preview port (`S/preview/roots/writingActions.ts:60-73`); `rawLogFile` (`S/preview/roots/rawLogFile.ts`) -> `<projectBuildDir(settings.id)>/<rootBuildFolder(root)>/<base>.log`, LaTeX only.
- Words: `S/preview/limits/rootWords.ts`; limits written by `S/preview/limits/setCheckLimits.ts`. Bib sync `S/citations/bibliographySync.ts` (no status exposed). Versions: `S/versions/` (markVersion, compareVersions, showHistory).
- Bundle: `packages/vscode/build/webviews.mjs:21` maps `projects/projects` -> `src/writing/allProjects/webview/main.ts`. Test: `packages/vscode/__tests__/writing/allProjects/projectLibrary.test.ts`.
