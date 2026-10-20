# Session 6 — VS Code wiring

- **Goal:** Spaces work in VS Code: sidebar section, catalog and Space panels, Add to Space, Research chat view, conflict copies.
- **Starts from:** session 5 committed.
- **Ends with:** A1–A13 can be checked by hand in the extension host.
- **Owns:** `packages/vscode/` (package.json, build, tsconfig, src, __tests__).

Runs alone (changes package.json and the build). App facts: [research/codebase-apps.md](../research/codebase-apps.md).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 6.1 | Host port, store, commands, contributions | contract | implementer (sonnet) | tests pass | [ ] |
| 6.2 | Catalog and Space panels | behaviour | implementer (sonnet) | tests pass | [ ] |
| 6.3 | Sidebar section | behaviour | implementer (sonnet) | tests pass | [ ] |
| 6.4 | Add to Space and Research chat view | behaviour | implementer (sonnet) | tests pass | [ ] |
| 6.5 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

6.1 first; then 6.2, 6.3 and 6.4 in parallel.

## 6.1 — Host port, store, commands, contributions

- **Goal:** the composition root builds a `SpaceStore` per library root and a `SpacesHostPort`, and package.json declares everything this session needs.
- **Read only:** `packages/vscode/src/activation/activateExtension.ts:17-62`; `serviceComposition/buildServices.ts:27-81`; `src/writing/allProjects/projectLibrary.ts`; `packages/core/src/spaces/{index.ts,spacesHostPort.ts}`; `packages/vscode/package.json` (`contributes`).
- **Decided:** store and port in `src/spaces/host/`; rebuilt on `controller.onDidChangeRoot`. A `FileSystemWatcher` on `spaces/**` calls `store.reload()`. `saveFile` uses `showSaveDialog`. Projects come from the existing project list plus the core `SpaceProjectInfo` helper. Commands `labshelf.spaces.all`, `labshelf.spaces.open`, `labshelf.spaces.new`, `labshelf.researchChat.toggle`; a webview view `labshelf.researchChat` in the `labshelfDetails` container. Conflict copies with owner `space` show the label "Space" wherever conflicts are listed.
- **Done when:** tests: the port's `saveFile` writes what the dialog returns; the watcher reloads the store; the manifest declares the commands and view. `pnpm --filter @labshelf/vscode typecheck` and `test` pass.

## 6.2 — Catalog and Space panels

- **Goal:** `labshelf.spaces.all` opens the catalog panel (singleton); opening a Space opens one panel per Space; both from one `spaces` webview bundle.
- **Read only:** `src/writing/allProjects/{index.ts,allProjectsPanel.ts:15-80,allProjectsHtml.ts,webview/main.ts,webview/allProjectsChannel.ts}`; `src/webviewMessaging/webviewTransport.ts`; `build/webviews.mjs:15-25`; `tsconfig.webview.json`.
- **Decided:** panels in `src/spaces/panels/`, webview in `src/spaces/webview/` (added to `tsconfig.webview.json` and `BUNDLES`). The HTML passes `{ view, id, tab }`; the panel title is the Space name; the inner tab is kept with `setState`. The host side is `serveSpaces` over the webview transport. Opening an already open Space reveals its panel.
- **Done when:** tests against the mocked `createWebviewPanel`: one panel per Space; a second open reveals it; bundle-missing HTML when `dist/spaces` is absent. Typecheck and test pass.

## 6.3 — Sidebar section

- **Goal:** the sidebar webview shows the Spaces section and its actions reach the store.
- **Read only:** `src/ui/library/{librarySidebarView.ts:43-164,sidebarMessages.ts:1-107}`; `src/activation/registration/registerLibrarySidebar.ts:36-67`; `src/sidebarWebview/main.ts:1-80`; `packages/core/src/library-ui/dom/sidebar/spaces/index.ts`.
- **Decided:** host → webview `spaces { rows }` pushed on store and library change (same 60 ms debounce, replayed on `ready`); webview → host messages for each `SidebarSpaceActions` entry, validated in `parseSidebarMessage`; rename and New Space use `showInputBox`.
- **Done when:** parser tests for every new message; a store change posts `spaces`. Typecheck and test pass.

## 6.4 — Add to Space and Research chat view

- **Goal:** `paper.addToSpace` runs a Space quick pick and adds the papers; the Research chat view hosts the core panel.
- **Read only:** `src/ui/list/host/` (where library-ui messages are handled); `src/details/` (the secondary-sidebar view to copy); `packages/core/src/spaces/dom/chat/index.ts`.
- **Decided:** the list host advertises `spaces: true`; the quick pick lists Spaces plus "New Space…"; a toast confirms. The chat view sets its context to the active Space panel's name, else none.
- **Done when:** a host test for `paper.addToSpace`; typecheck and test pass.

## 6.5 — Check, commit

`check` on Owns. Commit: `Wire Spaces into VS Code`.
