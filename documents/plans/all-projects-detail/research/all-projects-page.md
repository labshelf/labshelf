sha: 18723264 (plus the uncommitted All projects page)
files: packages/core/src/writing/allProjects/**, packages/core/__tests__/writing/allProjects/**
source: Explore scout, 2026-10-17

# Core All projects page as it stands

Paths are relative to `packages/core/src/writing/allProjects/`.

## Files (lines)

- Root (3): `projectRow.ts` 38 (row, place, menu-command types), `projectLibraryPort.ts` 24 (host port), `serveAllProjects.ts` 84 (host side of the protocol).
- `protocol/` (2): `messages.ts` 34 (unions, `Transport` = `MessageEnd` from library-ui/protocol), `parseAllProjectsMessage.ts` 31 (validates webview->host).
- `derive/` (2): `projectViewState.ts` 17, `deriveProjectView.ts` 72.
- `dom/` (8, AT THE LIMIT): `mountAllProjects.ts` 86 (composition, `PageState`), `allProjectsHeader.ts` 102, `projectList.ts` 132, `projectRowView.ts` 57, `projectListKeys.ts` 38, `projectMenu.ts` 50, `projectActions.ts` 56, `projectEmptyState.ts` 30.
- `dom/tray/` (3): `projectTray.ts` 74, `projectExpansion.ts` 52, `projectFileTree.ts` 48. `dom/styles/all-projects.css` 40.
- Tests: `serveAllProjects.test.ts` 107, `protocol/parseAllProjectsMessage.test.ts` 29, `derive/deriveProjectView.test.ts` 51, `dom/tray/projectFileTree.test.ts` 24. No DOM tests.

## Types

- `ProjectRow` (projectRow.ts:9-25): `id, title, format?, folder?, place, modified? (epoch ms), trashedAt? (ISO), openItems?, external?, broken?, main?`.
- `ProjectLibraryPort`: `list, onDidChange, commands, open, create, rename, duplicate, move, setArchived, setTrashed, deleteForever, runCommand(id, command), files(id): Promise<string[]>, openFile(id, path)`.
- `AllProjectsToHost`: ready | open | create | rename | duplicate | move | archive | trash | deleteForever | emptyTrash | command | files | openFile.
- `HostToAllProjects`: projects{rows, commands} | error{message} | files{id, files} | files{id, error}.
- `ProjectSortKey = "title" | "openItems" | "modified"`; default sort modified desc; `firstProjectSortDir`: title asc, others desc. Missing numeric values sort last both ways; trash sorts "modified" by `trashedAt`. Groups by folder only in the "projects" place.

## DOM

- Layout: `.ls-library.ls-all-projects > .list-pane > .list-header + .list-body`. One pane, no detail.
- Header (`allProjectsHeader.ts:36-102`): place tabs `.ls-place-tab` with counts, `.ls-search` (80 ms debounce, "/" focuses, Esc clears), "New project" button, "Empty trash" button. New menu built in `mountAllProjects.ts:28-34` with `showMenu` (Blank / From template… / Add existing folder…).
- Heads `projectList.ts:34-43`: twistie, Title, Open items (`col-open`), Last modified / Trashed (`col-modified`), actions. Reuses `GroupedRows`, `RowReconciler`, `sortableHeadHtml`, `paintSortableHeads`, `wireSortableHeads` from library-ui/dom and classes `paper-list col-heads paper-rows paper-row paper-row-main expand-btn paper-children`.
- Cells `projectRowView.ts` (`buildProjectRow`/`rowHtml`): twistie, `formatLabel` (library-ui) or broken warning, highlighted title, external icon, open items, time via `relativeTime(iso, now)` (`packages/core/src/library/format/elapsedTime.ts:15`), "more" button.
- Tray `dom/tray/projectTray.ts` (`paintProjectTray`): `buildTrayRow`, `buildLoadingRow`, `buildFailedRow`, `replaceTrayRows`, `TrayEntry` from library-ui/dom; tones pdf/md/other/dir; a "main document" fact.
- Selection exists: `PageState.selected` (`mountAllProjects.ts:15-20`), `paintSelection` toggles `.selected`/aria-selected; cleared on place change or when the row leaves the view. Double-click posts "open".

## serveAllProjects(endpoint, port, logger)

Posts nothing until "ready"; then posts projects (port.list + port.commands) and again on `onDidChange`. "files" posts files or error. "emptyTrash" deletes every trash row. Other messages map one-to-one to port methods. Failures log at ERROR and post `{type:"error", message:"<Action> failed: …"}`.
