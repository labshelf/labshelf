# Plan: All projects detail pane

Status: approved
Size: 4 sessions — one core data/contract session, then list+tray, the VS Code host and the detail pane (two of them in parallel)

## 1. Goal

The All projects page becomes a project manager in the Library's shape: denser real columns (engine, citations, build state, modified), a file tray that says what each file is for, and a right detail pane for the selected project with its limits, build, bibliography, citations and versions. The page stays in core behind `ProjectLibraryPort`, so the browser extension can host it later; VS Code is the first host.

## 2. Decisions

- [ ] **D1** Show real fields only. Every element maps to data in [research/element-map.md](research/element-map.md); project tags are dropped (Q2) and the Open items column is deleted with `ProjectRow.openItems` and its sort key, because the mockup has no place for it.
- [ ] **D2** Core data shapes: `ProjectRow` gains `cites?`, `unresolvedCites?`, `build?: BuildMark`, `target?`; a new `ProjectDetail` type and the port methods `detail, build, preview, openLog, createFile, setTarget, openLabel` live in `packages/core/src/writing/allProjects/`. The detail is read by a core node function `readProjectDetail` (in `allProjects/node/`) over existing writing functions, so the terminal can reuse it; the host only supplies the session build summary and the PDF/log paths. — Core-first; the browser host implements the same port.
- [ ] **D3** Build state is session-only: `ok | warnings | failed | building` from the host's build outcomes, `earlier` when a PDF exists but nothing was built this session (time = PDF mtime), `never` (hollow dot) otherwise. No build summary is persisted (Q3).
- [ ] **D4** Unresolved citations: a cited key that matches no library paper and no entry in any `.bib` file of the project. No build needed, so the column is right for every project.
- [ ] **D5** The pane reuses the Library shell: `buildFrame` takes an options object (`withSidebar`, `withCitationMap`, `detailLabel`) and a pane-prefs port; `tabBarHtml` takes a tab list; `detailMarkup` builders (`section`, `kv`, `iconBtn`, `muted`, `loading`) are exported from `library-ui/dom/index.ts`. The project pane uses the Library classes (`.detail-head`, `.detail-tabs`, `.detail-section`, `.kv-grid`) and adds only a limit bar and a build dot in `all-projects.css`.
- [ ] **D6** The place tabs stay; the active tab with its count is the page title ("All projects 5").
- [ ] **D7** `+ Add file` asks for a project-relative path in core quick input; the host creates the empty file and opens it. The parser rejects empty, absolute and `..` paths (trust boundary).

Open (blocks approval):

- **Q1** Decided: add `target: {venue, deadline: YYYY-MM-DD}` to `labshelf.yaml`, edited from the pane.
- **Q2** Decided: drop project tags.
- **Q3** Decided: the build summary is session-only; the `earlier` state covers a PDF from an earlier session.

## 3. Acceptance

- [ ] **A1** The list shows twistie | Title (+ venue chip) | Engine | Cites (red unresolved count) | Build dot | Modified ("2 h"); Modified desc is the default sort; Title, Cites and Modified sort from their heads.
- [ ] **A2** Expanding a project shows each file with its role (Main, Bibliography, Contents, Last build) and fact, a `main.log` row for a LaTeX project with a log, and `+ Add file`, which creates and opens the file.
- [ ] **A3** Selecting a project fills the right pane (title, "…" menu, meta line, Open in VS Code, Preview, build status, tabs); the panel-right button and the sash collapse and resize it, and the state survives a reload.
- [ ] **A4** Overview shows Target & limits (pages counted / limit with a bar and "1 page left · counted up to the references", words), Build (engine, main, last build, Build now, Open log), Bibliography and a collapsed Location. Build now builds that project even when another project's file is active.
- [ ] **A5** Citations lists cited keys with the library title, flagging unresolved ones; Versions lists marked versions with their time.
- [ ] **A6** Setting a venue and deadline writes `target:` to `labshelf.yaml` keeping comments and key order, and the chip shows the days left, in the warning colour within 14 days. (Q1)
- [ ] **A7** `pnpm --filter @labshelf/core test` and `pnpm --filter @labshelf/vscode test` pass, including new tests for the target key, the protocol parser, the sort, `readProjectDetail` and the deadline text; the Library page tests pass unchanged.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-core-data.md](sessions/1-core-data.md) | target key, row/detail types, port, protocol, readProjectDetail | `packages/core/src/writing/{project,allProjects/*.ts,allProjects/protocol,allProjects/derive,allProjects/node,checks}`, their tests, `documents/contracts/library-format.md` | alone (not with writing-2-submission-tools session 01, which owns the same contract) |
| 2 | [sessions/2-list-tray.md](sessions/2-list-tray.md) | columns and tray in core | `packages/core/src/writing/allProjects/deadlineText.ts`, `packages/core/src/writing/allProjects/dom/{projectList,projectRowView,mountAllProjects}.ts`, `dom/tray/`, `dom/detail/detailRequests.ts`, `dom/styles/all-projects.css` | 3 |
| 3 | [sessions/3-vscode-host.md](sessions/3-vscode-host.md) | VS Code port adapter | `packages/vscode/src/writing/allProjects/` except `webview/`, its tests | 2, 4 |
| 4 | [sessions/4-detail-pane.md](sessions/4-detail-pane.md) | the detail pane | `packages/core/src/library-ui/dom/{shell,detail,header,index.ts}`, `packages/core/src/library-ui/dom/mountLibraryUi.ts`, `packages/core/src/writing/allProjects/dom/` except `dom/tray/` and `dom/detail/detailRequests.ts`, `packages/vscode/src/writing/allProjects/webview/` | 3 (after 2) |
