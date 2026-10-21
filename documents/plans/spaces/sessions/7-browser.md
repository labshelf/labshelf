# Session 7 — Browser wiring

- **Goal:** Spaces work in the browser extension's library page: sidebar section, catalog and Space tabs, Add to Space, Research chat in the right pane.
- **Starts from:** session 6 committed.
- **Ends with:** A1–A11, A13, A14 can be checked by hand in the browser.
- **Owns:** `packages/browser/src/`, `packages/browser/__tests__/`.

Runs alone. App facts: [research/codebase-apps.md](../research/codebase-apps.md).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 7.1 | Host port, store, tab kinds | behaviour | implementer (sonnet) | tests pass | [ ] |
| 7.2 | Sidebar section and Add to Space | behaviour | implementer (sonnet) | tests pass | [ ] |
| 7.3 | Research chat in the right pane | behaviour | implementer (sonnet) | tests pass | [ ] |
| 7.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

7.1 first; then 7.2 and 7.3 in parallel.

## 7.1 — Host port, store, tab kinds

- **Goal:** the tab kinds `spaces` (catalog) and `space` (one Space) mount the core pages over a loopback served by `serveSpaces`.
- **Read only:** `src/library-page/main.ts` (`boot`, ~92-130); `src/library-page/tabs/{types.ts,tabKinds.ts:1-50,all-projects/index.ts}`; `src/library-page/sections/pagePlan.ts`; `src/storage/libraryFileSystem.ts`; `src/library-page/host/snapshots/librarySnapshots.ts`; `packages/core/src/spaces/{index.ts,spacesHostPort.ts}`.
- **Decided:** store and port in `src/library-page/spaces/`, built in `boot()` over `createLibraryFileSystem`; the store reloads on the `library.changed` broadcast and on page visibility. `space` params: `id`, `tab`; the inner tab change rewrites the tab id so the hash keeps it. `isKindShown`: both kinds follow `plan.library`. Projects come from the projects source when project wiring is loaded, else the list is empty and linked projects show "Not on this device". `saveFile` downloads through an object URL.
- **Done when:** tests: the tab ids round-trip with `tab`; `isKindShown`; a `library.changed` reloads the store. `pnpm --filter @labshelf/browser typecheck` and `test` pass.

## 7.2 — Sidebar section and Add to Space

- **Goal:** the sidebar shows the Spaces section, and the paper menu's "Add to Space…" works.
- **Read only:** `src/library-page/sidebar/{sidebarTree.ts:1-62,sidebarProjects.ts:1-80}`; `src/library-page/host/hostController.ts` and its handlers; `packages/core/src/library-ui/dom/sidebar/spaces/index.ts`.
- **Decided:** `sidebar/sidebarSpaces.ts` feeds `setSpaces` and answers the actions with the store; New Space and rename use core `inputBox`. The host advertises `spaces: true` and answers `paper.addToSpace` with core `quickPick` (Spaces plus "New Space…") and a toast.
- **Done when:** tests: a store change updates the rows; `paper.addToSpace` adds to the chosen Space. Typecheck and test pass.

## 7.3 — Research chat in the right pane

- **Goal:** the right pane shows Details or Research chat, switched by two titlebar buttons.
- **Read only:** `src/library-page/workspace/{pageShell.ts:1-55,workspace.ts:1-85}`; `src/library-page/prefs/localStoragePrefs.ts`; `packages/core/src/spaces/dom/chat/index.ts`.
- **Decided:** one right pane; the chat toggle sits beside the Details toggle; the choice and the width persist in prefs; the chat context follows the active `space` tab.
- **Done when:** a jsdom test: the toggle swaps the pane and persists. Typecheck and test pass.

## 7.4 — Check, commit

`check` on Owns. Commit: `Wire Spaces into the browser extension`.
