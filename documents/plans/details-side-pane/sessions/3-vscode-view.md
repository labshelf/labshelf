# Session 3 — VS Code Details view in the secondary side bar

- **Goal:** a native `labshelf.details` view in the secondary side bar shows the last paper or project selected in the list tab, the All projects tab or the active reader.
- **Starts from:** sessions 1 and 2 committed (core exports `mountDetails`, `createSelectionHub` and the Details protocol; `paper.selected` carries `ids`; All projects posts `project.selected`).
- **Ends with:** A1–A5 work in VS Code. The in-tab panes still exist and are removed in session 5.
- **Owns:** `packages/vscode/` (package.json, build/webviews.mjs, src/).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Manifest, view, webview entry, host | contract | implementer (sonnet) | typecheck and build pass; the view renders a selected paper | [ ] |
| 3.2 | Selection sources and hub wiring | behaviour | implementer (sonnet) | A2–A4 by hand; hub use covered by core tests | [ ] |
| 3.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

3.2 depends on 3.1.

## 3.1 — Manifest, view and host

- **Goal:** register the Details webview view and serve both channels.
- **Read only:** `documents/plans/details-side-pane/research/vscode.md`, `packages/vscode/package.json:1-12,600-645,1250-1260`, `packages/vscode/build/webviews.mjs`, `packages/vscode/src/ui/list/listWebviewPanel.ts:60-190`, `ui/list/host/hostContext.ts`, `ui/list/listPanelHtml.ts`, `writing/allProjects/allProjectsPanel.ts`, `writing/search/registerProjectSearch.ts`, `packages/core/src/details/protocol/messages.ts`.
- **Decided:**
  - **package.json:** `engines.vscode` and `@types/vscode` become `^1.106.0`. Add `viewsContainers.secondarySidebar: [{id:"labshelfDetails", title:"LabShelf Details", icon: <the core panel-right icon file already used for containers, or the LabShelf icon>}]` and `views.labshelfDetails: [{type:"webview", id:"labshelf.details", name:"Details"}]`. Raise the esbuild target in `build/webviews.mjs` to the Chrome of the Electron in VS Code 1.106, and fix its comment.
  - **Webview entry:** `src/detailsWebview/main.ts` mounts core `mountDetails` with `createWebviewChannel()` and the webview prefs. Add a `details` bundle in `BUNDLES`. Move the capabilities and labels currently in `libraryWebview/main.ts:14-25` into one shared vscode module that both entries import. Extend `listPanelHtml`'s bundle union with `details`, and add img-src as the list has.
  - **Host:** `src/details/` holds `DetailsView implements WebviewViewProvider` (with `retainContextWhenHidden`) and its registration. The library channel builds a `ListHostContext` and calls `handleListMessage`. Extract the snapshot, jobs and sidecar push plus the change subscriptions from `ListWebviewPanel` (lines 70-75, 95, 178-190) into one reusable vscode unit, used by both the list panel and Details, with a `ReadyQueue` for each. The projects channel wraps the view in an `AllProjectsEndpoint` and calls core `serveAllProjects` with the existing `projectLibrary.ts` port. Messages are parsed with `parseDetailsMessage`. Failures are logged through `ILogger` with the channel and message type.
  - `ui/list` is at 8 files: put new and extracted code in new folders, not in `ui/list`.
- **Done when:** `pnpm --filter @labshelf/vscode typecheck` and `build` pass, and the view shows a paper when the host sends a hard-coded `details.show` (3.2 replaces that test call).
- **Do not touch:** core, browser, and the in-tab panes.

## 3.2 — Selection sources

- **Goal:** feed the hub from the list tab, All projects and the active reader, and re-announce on tab activation.
- **Read only:** `documents/plans/details-side-pane/research/vscode.md`, `packages/vscode/src/activation/registration/registerPanelCommands.ts:26-62`, `ui/list/listWebviewPanel.ts:30-60,140-160`, `writing/allProjects/allProjectsPanel.ts`, `pdf-viewer/ReaderPanel.ts:40-60,110-125,165-190`, `packages/core/src/details/selectionHub.ts`, the `src/details/` host from 3.1.
- **Decided:**
  - The composition root creates one hub with `show = target => detailsView.show(target)`. The view keeps the target and replays `hub.current()` after `ready`.
  - **List:** `paper.selected {ids}` calls `publish("list", ids.length ? {kind:"paper", ids} : null)`. The existing `onDidSelectPaper` (tree mark) stays for exactly one id.
  - **All projects:** `project.selected` calls `publish("projects", id ? {kind:"project", id} : null)`.
  - **Reader:** `ReaderPanel` exposes a static `onDidActivatePaper` event, fired from `onDidChangeViewState` when a panel becomes active, carrying its paper id. It calls `publish("reader", {kind:"paper", ids:[id]})`.
  - The list and All projects panels call `hub.activate(source)` when `onDidChangeViewState` reports them active.
  - Folder-open requests from Details (the folder-open message in `documents/contracts/details-host.md`) are forwarded to the list panel as `navigate`, opening the list tab when it is closed.
  - Log every publish failure. Do not log in the selection hot path.
- **Done when:** typecheck and build pass, and A2–A4 are checked by hand in the extension host (see `documents/apps/README.md#verifying-changes`).
- **Do not touch:** core, browser.
