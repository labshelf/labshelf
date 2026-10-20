# Session 4 — Browser page-level Details pane

- **Goal:** the library page has one right Details pane outside the internal tabs that follows the last selection.
- **Starts from:** session 3 committed.
- **Ends with:** A7 works, and A2–A5 work for the browser's library and All projects tabs. The in-tab panes still exist and are removed in session 5.
- **Owns:** `packages/browser/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Page pane, host wiring, sources | behaviour | implementer (sonnet) | typecheck and build pass; A7 by hand | [ ] |
| 4.2 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 4.1 — Page pane, host and sources

- **Goal:** mount core `mountDetails` in a page-level pane, serve its two channels and feed the hub.
- **Read only:** `documents/plans/details-side-pane/research/browser.md`, `packages/browser/src/library-page/main.ts:55-104`, `workspace/pageShell.ts`, `workspace/workspace.ts` (tab switch and tab bar parts), `tabs/all-projects/index.ts`, `host/hostController.ts:20-93`, `prefs/localStoragePrefs.ts`, `page.css`, `packages/core/src/details/index.ts`.
- **Decided:**
  - **Pane:** `pageShell` appends a sash and an `aside` for the right pane after `centre`. Reuse core `attachSash` with `PANE_LIMITS.detail`. `PagePrefs` stores the width and collapsed state; reuse the existing `detailWidth` and `detailCollapsed` keys, which now belong to the page. A panel-right icon button at the end of the workspace tab bar toggles the pane. Use tokens only.
  - **Channel:** one loopback for Details. Serve the library channel with a second `attachLibraryHost` on the unwrapped library endpoint, so snapshot and details work the same as for the list. Serve the projects channel with core `serveAllProjects` and `createBrowserProjectLibrary`. If `attachLibraryHost` cannot serve two endpoints (it may push snapshots to one endpoint only), fix it there instead of copying it.
  - **Sources:** `hostController` stops ignoring `paper.selected`. It calls `publish("list", …)` through a hub passed in by `main.ts`. The All projects tab routes `project.selected` to `publish("projects", …)`. When the workspace activates the library or All projects tab, it calls `activate` for that source. Closing the All projects tab leaves Details as it is.
  - The browser reader is a separate browser tab and is not a source.
- **Done when:** `pnpm --filter @labshelf/browser typecheck`, `test` and `build` pass, and A7 is checked by hand in the headless or real browser (see `documents/apps/README.md#verifying-changes`). The workspace/ folder must stay at or under 8 files.
- **Do not touch:** core and vscode.
