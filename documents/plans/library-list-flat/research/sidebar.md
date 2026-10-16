sha: 1d6fdd7
files: packages/vscode/package.json, packages/vscode/src/ui/library/*, packages/vscode/src/activation/registration/registerLibraryTreeView.ts, packages/vscode/src/ui/list/**, packages/vscode/src/writing/tree/*, packages/browser/src/library-page/**, packages/core/src/library-ui/**
source: Explore scout, 2026-10-16

# Side bars

## VS Code: native TreeView
- `labshelf.library` view (package.json:448, type tree) in `labshelfContainer` (:439/:446); viewsWelcome at :497-507. `createTreeView` in registerLibraryTreeView.ts:65 with DnD and `showCollapseAll` (:68).
- Provider ui/library/libraryTreeDataProvider.ts (170 lines): Continue rows (continueNode.ts, ThemeIcon book/edit), "All Papers" root (ThemeIcon library, :79), folders (ThemeIcon.Folder, description = recursive count :88; click runs `labshelf.openListTab` :91). No papers, no status scopes.
- getParent (:118) is for folders only; ids = folder dirPath. `syncTreeToPanel` (registerLibraryTreeView.ts:82) reveals the open folder with `{select:true, focus:false, expand:true}` only when the tree is visible; re-run on `onDidChangeVisibility` (:90). Passed into extension.ts:58/66.
- TreeItem cannot style label text; a mark must be an iconPath SVG or ThemeIcon. `arcIcons` (ui/arcMarkIcons.ts, exported ui/index.ts:3) produces the arc SVGs; not used inside ui/library/ yet.
- Tree to list: `labshelf.openListTab` (registerPanelCommands.ts:50) calls `ListWebviewPanel.createOrShow` (ui/list/listWebviewPanel.ts:38), which calls `navigateTo` (:91) when a panel exists. `_showFolder` (:164) posts `navigate` only if `tellUi` and the UI folder differs.
- `_post` (listWebviewPanel.ts:135-137) silently drops messages unless `_webviewReady && !_disposed`; no queue. `_webviewReady` is set in `onReady` (:127), which then calls `_pushState()` (full snapshot) and `_uiFolder = undefined`. Pattern for a deferred message: `_citationMapRequested` (:57/:128).
- Webview→host `navigate` is handled at ui/list/host/messageHandler.ts:22 via `ctx.onNavigate` (listWebviewPanel.ts:130) → `_showFolder(..., false)`: the existing UI-to-tree path for folders.

## Host to webview dispatch
- Core dom/hostMessages.ts: `applyData` (:12-23) handles data messages; `attachHostMessages` (:28) subscribes via `ctx.transport.subscribe` and switches at :40-48.
- Host→webview `select {id}` (protocol/messages.ts:45) exists, handled at hostMessages.ts:41 as `ctx.store.selectOnly(m.id)` (no folder change, no scroll). Only the browser sends it (hostController.ts:29, addFromTabHandler.ts:33).
- Webview `paper.reveal` (messages.ts:18, messageHandler.ts:38) means reveal on disk (menu: paperMenu.ts:54).

## Core pieces
- dom/flows/revealPaper.ts:9 `revealPaper(ctx: UiContext, id: string): void`: finds the paper in `store.get().papers` (returns silently if absent); outside `s.folder` (and folder not PAPERS_DIR) → `store.openFolder(parentDir)`; else if filtered out of `deriveListView(...).rows` → resets `status:"all", noText:false, query:""` (+`includeSub:true` if the folder differs); then `store.selectOnly(id)` and scrolls `.paper-row[data-id]` into view. Exported from flows/index.ts:9; used only by detailActions.ts:53 ("openRelated"). Not wired to a host message.
- derive/folderTree.ts:1-18: `CountedFolder {name,path,total,children}`, `folderTreeFromSnapshot(snapshot: LibrarySnapshot)` (paths start at `papers`, from `snapshot.collections`). No tree with papers.

## Selection state
- `selected: ReadonlySet<string>` (state/viewState.ts:29), plus `anchor` and `cursor`. Mutators in state/libraryViewStore.ts: `selectOnly` :99, `toggleSelected` :104, `selectRange` :111, `clearSelection` :119. `select(selector, listener)` (:39) subscribes to slices.
- No webview→host message reports selection changes.

## Browser
- library-page/main.ts:28-29 mounts `mountLibraryUi(root, {transport, prefs, withSidebar: true, ...})`; core shell/frame.ts:14 exposes `sidebar`, filled by library-page/sidebar/sidebarTree.ts (165 lines; also citationMapEntry.ts, index.ts): All papers row (:62), folders with `countPapersUnder` (:65), DnD, context menu (:109), keyboard nav (:121), selected folder from `store.get().folder` (:28). No papers, no status scopes.

## Duplicates
- Folder tree built twice: core `folderTreeFromSnapshot` (VS Code) vs store folders + `countPapersUnder` (browser). Also library/model/collectionTree.ts.

## Projects
- VS Code `labshelf.writing` native tree (writing/tree/projectsTreeProvider.ts and siblings). Browser: none.
