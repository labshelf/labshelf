sha: 856ffa3
files: packages/vscode/src/**, packages/vscode/package.json, packages/vscode/build/webviews.mjs
source: Explore scout; https://code.visualstudio.com/updates/v1_106

# VS Code: detail glue today

Paths relative to `packages/vscode/src`.

## Manifest and build
- `package.json`: `engines.vscode` is `^1.98.0` at line 8, and `@types/vscode` is `^1.98.0` at line 1256. `viewsContainers` starts at line 602 (`activitybar` labshelfContainer, `panel` labshelfSearch). `views` starts at line 618.
- `viewsContainers.secondarySidebar` is stable from VS Code **1.106** (October 2025). Before that it was a proposed API (`contribSecondarySideBar`).
- `build/webviews.mjs:15-24` holds the `BUNDLES` map of out to src. `:34` notes that the esbuild target matches the Electron of 1.98, so raise it with the engine.

## List tab host (reusable seam)
- `ui/list/host/hostContext.ts:10-26` `ListHostContext {deps, paths(), post, notice, papers(ids), onReady, onNavigate, onSelect}`. It is built only in the private `ListWebviewPanel._hostContext()` (`ui/list/listWebviewPanel.ts:128-152`).
- `ui/list/host/messageHandler.ts:60-79` `handleListMessage(ctx, raw)` is a pure dispatcher. It answers paper.details, similar, setStatus, setTags, setNote, open, files and clipboard.
- `ui/list/host/paperData.ts:21-46` `sendDetails`/`sendSimilar`.
- `ui/list/readyQueue.ts` `ReadyQueue(send)` buffers messages until `ready`.
- `ui/list/listWebviewPanel.ts`: snapshot and jobs push at 178-190. Change subscriptions are at 70-75 (`sidecarChanged` on annotationChanged and pdfViewerClosed, `snapshot` on paper change) and :95 (`sidecarChanged{id:null}` on projectBacklinks). `onSelect` at :151 calls `deps.onDidSelectPaper(id)`.
- `ui/list/listPanelHtml.ts:15-37` `listPanelHtml(webview, extensionUri, bundle)`, where bundle is `'library'|'sidebar'`.
- `ui/list/listPanelDeps.ts:36-80` `ListPanelDeps`, built in `activation/registration/registerPanelCommands.ts:32-52`. `:41` sets `onDidSelectPaper: showPaperInSidebar`.
- `libraryWebview/main.ts:14-25` declares the capabilities in the webview (textLayer, similar, reveal, openExternal, fetchMetadata) and the labels.
- `ui/list` has 8 files (at the limit) and `ui/list/host` has 7.

## All projects
- `writing/allProjects/allProjectsPanel.ts:1-53` wraps the webview in an `AllProjectsEndpoint`, validates with `parseAllProjectsMessage`, and calls core `serveAllProjects(endpoint, port, logger)`. The port is in `writing/allProjects/projectLibrary.ts`. The HTML is in `allProjectsHtml.ts`. The bundle is `dist/projects/projects.js`.

## Selection sources
- Sidebar tree (`ui/library/librarySidebarView.ts`, `sidebarWebview/main.ts`): a paper click sends `revealPaper`, which opens the list tab, which reveals and selects the paper, which posts `paper.selected`. `showPaper(id)` (:95) marks the tree.
- Reader `pdf-viewer/ReaderPanel.ts`: `activePanel` (:50) is static and private, set in `onDidChangeViewState` (172-178). The paper comes from `source.paper` (:119). It has no public event.
- `events/libraryEvents.ts:7-26` has no selection event.

## Webview view pattern
- `writing/search/registerProjectSearch.ts:26` uses `registerWebviewViewProvider(id, view, {webviewOptions:{retainContextWhenHidden:true}})`.
- `ui/library/librarySidebarView.ts:69-76` sets options, sets html with `listPanelHtml`, and replays state after `ready`.
