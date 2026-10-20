sha: 856ffa3
files: packages/browser/src/library-page/**, packages/browser/src/reader/**
source: Explore scout

# Browser: library page today

Paths relative to `packages/browser/src`.

## Boot and layout
- `library-page/main.ts:58-102` boots the page. It creates `createLoopbackTransport()` (:64, an in-document synchronous loopback), calls `attachLibraryHost(endpoint)` (:67) and `createPageShell` (:69), then mounts `mountLibraryUi(libraryView, {transport, prefs, withSidebar:false})` (:71-72) into a detached div. It calls `createWorkspace(shell.centre, ...)` (:86) and `mountSidebarTree` (:95).
- `library-page/workspace/pageShell.ts:13-29` builds `.ls-library.has-sidebar` from the sidebar, a sash (`attachSash`) and `centre`. The page-level right pane goes here. workspace/ has 4 files.
- `library-page/workspace/workspace.ts` (169 lines) holds the tab bar and switches tabs. `tabs/types.ts` defines `TabModule.mountTab(host, params, ctx)`. `tabs/tabKinds.ts:13-22` lists library, all-projects, templates, source, preview, comments, history and search.
- `tabs/library/index.ts` appends the persistent `ctx.libraryView`.
- `tabs/all-projects/index.ts:8-17` creates a new loopback and calls `serveAllProjects(endpoint, createBrowserProjectLibrary(...))` and `mountAllProjects(body, {transport, prefs})` on every open. Closing the tab disposes them, so the selection is lost.
- `library-page/page.css` (51 lines): `.ls-workspace-centre {flex:1}`. `index.html` loads the token, base and library-detail sheets.
- `library-page/prefs/localStoragePrefs.ts` `createLocalStoragePrefs()` is one prefs object shared by the shell, the library view and All projects (`detailWidth`, `detailCollapsed`).

## Host
- `library-page/host/hostController.ts:74-93` `attachLibraryHost(endpoint)`, dispatch at :38-71. `paper.details` goes to `sendDetails` in `host/handlers/paperDataHandlers.ts`. `paper.selected` is ignored at :51-52. `onReady` sends `select` for `?paper=` (:28-31).
- `library-page/projects-data/browserProjectLibrary.ts` is the All projects port.
- `library-page/router.ts` maps `#/papers/<folder>/<id>` to a selection.

## Reader
- The reader is a separate browser tab (`reader/index.ts`, `reader/access/readerTabs.ts:38-49`), not part of the library page. The Preview tab embeds the reader in an iframe only for project PDFs.

## Docs
- `documents/apps/browser.md:50-56` covers the sidebar and workspace, `:92` Ask the author in the detail pane, and `:114` the loopback.
