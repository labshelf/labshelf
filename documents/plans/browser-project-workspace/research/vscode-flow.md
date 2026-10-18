sha: 7c2715b7
files: packages/core/src/library-ui/dom/**, packages/vscode/src/{sidebarWebview,ui/library,writing/session,writing/preview}/**, packages/browser/src/library-page/**
source: Explore scouts + user screenshots, 2026-10-18

## The VS Code flow the browser replicates (user's screenshots)
1. Nothing open: empty centre. Sidebar: Library (collapsed), Projects with "Explore templates", "All projects", "My projects" (folders, projects, "missing" rows).
2. All projects → a centre tab with the project treegrid; the right detail pane is empty until a project is selected, then shows its overview (title, format · main · pages · modified, Open / Preview, Overview / Citations / Versions).
3. Explore templates → a second tab; the first stays and can be reselected.
4. All papers (Library) → a third tab with the paper list and detail pane.
5. Opening a project: the tabs stay; the centre splits in two groups: left keeps the old tabs plus the main source file, right shows the PDF preview (Recompile, page nav, zoom; footer with cites, pages, words).
6. With a project open, the Projects section shows only the project row (name, format badge, chevron menu) and its Files / Outline / Checklist panes (Checklist has By kind / By section); the Library section collapses.

## Core sidebar
- `mountLibrarySidebar(slot, options)` (core/src/library-ui/dom/sidebar/mountLibrarySidebar.ts:140; API :36-44: setProjects, setProjectOffers, setOpenProject). Rows "Explore templates" / "All projects" render only with no open project (sidebarView.ts:127-139), gated by `ProjectOffers.templates` / `.allProjects` (sidebarProjects.ts:8-45, `ALL_PROJECT_OFFERS`).
- `SidebarProjectActions`: open, menu, browseTemplates, allProjects, newBlank, addExisting, newFolder, renameFolder, deleteFolder, refresh, closeProject, openProjectMenu, treeAction, treeClick, treeToggle, treeCheck, treeMenu, treeAdd.
- vscode wiring example: packages/vscode/src/sidebarWebview/main.ts:19-80; host dispatch vscode/src/ui/library/librarySidebarView.ts:112-153, sidebarProjectMessages.ts:12-33.
- vscode open/close: vscode/src/writing/session/projectSession.ts:46-98 (open: close a different project, open main, show built PDF beside or build; close: close that project's tabs + preview, abort on cancelled dirty close); preview follows the active editor's build root (vscode/src/writing/preview/focusFollower.ts:21-47).

## Browser library page today
- packages/browser/src/library-page/main.ts:32-59: `mountLibraryUi(root, {withSidebar:true})` over `createLoopbackTransport` (core/src/library-ui/protocol/loopbackTransport.ts:31), host `attachLibraryHost`; sidebar via sidebar/sidebarTree.ts:10-39 and sidebar/sidebarProjects.ts (every offer off, project open → new tab with the editor page); router.ts (hash = folder path); statusBar/; openLink/; library-source banner and move offer.
- `mountLibraryUi` (core/src/library-ui/dom/mountLibraryUi.ts:47-77) builds the frame (shell/frame.ts:48-76: sidebar + list pane + detail pane, widths in prefs). No tab concept in core.
