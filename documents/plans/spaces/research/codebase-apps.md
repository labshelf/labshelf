sha: (plan draft, 2026-10-20)
files: packages/vscode/src, packages/browser/src
source: two Explore scouts at plan time

# App facts the briefs rely on

## VS Code
- Activation: `src/activation/activateExtension.ts:17-62`; services `serviceComposition/buildServices.ts:27-81` (`controller.currentServices()`, `onDidChangeRoot`).
- Sidebar is one webview view `labshelf.library`: host `src/ui/library/librarySidebarView.ts:43-164`, messages `src/ui/library/sidebarMessages.ts:1-107` (`parseSidebarMessage` rejects unknown types), registration `src/activation/registration/registerLibrarySidebar.ts:36-67`, webview `src/sidebarWebview/main.ts:1-80`.
- All projects panel to copy: `src/writing/allProjects/{index.ts:1-27, allProjectsPanel.ts:15-80, allProjectsHtml.ts, projectLibrary.ts, webview/main.ts, webview/allProjectsChannel.ts}`; transport `src/webviewMessaging/webviewTransport.ts`; bundle-missing html `src/ui/bundleMissing/`.
- Bundles: `build/webviews.mjs:15-25` (`BUNDLES`); webview folders listed in `tsconfig.webview.json` `include`.
- Details view lives in the secondary-sidebar container `labshelfDetails` (`src/details/`, `src/detailsWebview/`).
- Tests: `__tests__/` mirror, `vscode` mocked from `__mocks__/vscode/`; host panels tested against mocked `createWebviewPanel` (`__tests__/ui/listWebviewPanel.test.ts`, `ui/library/sidebarMessages.test.ts`).

## Browser
- Composition root `src/library-page/main.ts` `boot()` (~92-130). Shell `workspace/pageShell.ts:1-55` (sidebar | centre | Details; prefs `prefs/localStoragePrefs.ts`). Workspace `workspace/workspace.ts:1-85` over core `mountEditorArea`.
- Tab kinds: `tabs/types.ts` (`TabKindName` union at :11, `TabModule.mountTab(el, params, ctx)` ~:55), `tabs/tabKinds.ts:1-50` (`define(kind, paramNames, title, icon, lazyImport)`), template `tabs/all-projects/index.ts` (core page over loopback). Tabs persist in the URL hash.
- Sidebar: `sidebar/sidebarTree.ts:1-62` (`mountLibrarySidebar`), `sidebar/sidebarProjects.ts:1-80` (rows → `sidebar.setProjects`). Section plan: `sections/pagePlan.ts` (`isKindShown`: library kind → plan.library, others → plan.projects), `platform/sidebarSections.ts`.
- Projects: `projects/projectsSource.ts`, `projectWiring/mountProjectWiring.ts` (loaded only when plan.projects), `projects-data/pageProjectLibrary.ts`.
- Library data refresh: `host/snapshots/librarySnapshots.ts`, `library.changed` broadcast from the background.
- Tests: jest, env node, `/** @jest-environment jsdom */` per file; helpers `__tests__/support/{memoryLibraryFs,fakeIdb}`.
