# Session 8b — Wire the browser's project sharing into the common dialogs

- **Goal:** The browser library page shares, joins and leaves projects through the same core dialogs as VS Code, and shows the relay account where users look for it.
- **Starts from:** Session 6 is merged: the browser has a `ShareWorkflowPorts` implementation (key store, connections, project catalog, connect, deleteState, relay). Session 8 is merged: core `createSharingHost`, the dialogs and every control exist; the browser passes only the `links` half.
- **Ends with:** A9 is inspectable for projects in the browser.
- **Owns:** `packages/browser/src/library-page/host/handlers/browserSharingHost.ts`, `packages/browser/src/library-page/main.ts`, `packages/browser/src/library-page/projectWiring/`, `packages/browser/src/library-page/sidebar/sidebarProjects.ts`, the browser join path in `packages/browser/src/library-page/editor/collab/joinDialog.ts`, `packages/browser/src/options/`, `documents/apps/browser.md`. Matching tests and barrels.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 8b.1 | Project half and account settings | behaviour | implementer (sonnet) | Ends with above | [ ] |
| 8b.2 | Checks and docs | task | main thread | Evidence recorded | [ ] |

## 8b.1 — Work package

Read AGENTS.md first. Do not read other session files or log.md.

### Read only

- `packages/core/src/library-ui/sharing/workflows/createSharingHost.ts` and `projectSharingOps.ts:16-30` (`ProjectSharingDeps`: `ports`, `idOf`, `open`)
- `packages/browser/src/library-page/host/handlers/browserSharingHost.ts` (builds the host with `links` only)
- the browser's `ShareWorkflowPorts` implementation from session 6 (grep `ShareWorkflowPorts` under `packages/browser/src`)
- `packages/browser/src/library-page/projectWiring/mountProjectWiring.ts`, `packages/browser/src/library-page/editor/collab/joinDialog.ts`
- `packages/browser/src/relay/page/pageRelay.ts`, `packages/browser/src/options/index.ts`

### Decided work

1. Pass `projects: { ports, idOf: (entry) => <the browser project id the sidebar rows use>, open: (entry) => <open the project in the page session> }` to `createSharingHost`. The project controls then show in the sidebar and All projects menus.
2. Route the `#join` fragment through `runJoinProjectDialog(sharing, invite)` from `@labshelf/core/dom`, and delete `runJoinDialog` and whatever only it used. If the core join lacks the display-name step that `runJoinDialog` asks for, keep the name prompt as a browser step before the dialog, or put it in core if VS Code needs it too.
3. Replace the stubs `offerToShares` / `withdrawFromShares` in `library-page/main.ts` with core `offerOwnRelayToShares` / `withdrawOwnRelayFromShares` over the same ports.
4. Options page: show whether a Cloudflare relay account is connected (the account's relay host only, never a secret) and a button that opens the library page's existing connect/disconnect action. Sign-in stays in the library page, because its tab watcher must live there.

### Verification

Run a behaviour test for the deps builder only if it holds logic. Run browser typecheck, tests and build. Inspect Share Project, Join and Leave in light, dark and narrow layouts headless with the recipe in `documents/apps/README.md#verifying-changes`, without invoking verify and without a real Cloudflare account. Update `documents/apps/browser.md` to drop the "project half not wired" limit.

### Do not touch

`packages/core`, `packages/vscode`, credentials, external resources.
