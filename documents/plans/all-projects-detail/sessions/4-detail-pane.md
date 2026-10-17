# Session 4 — the project detail pane

- **Goal:** selecting a project fills a right detail pane, built on the Library's frame, sash, toggle, tabs and section builders.
- **Starts from:** session 2 committed (session 3 may still be running).
- **Ends with:** A3–A6 seen in the VS Code page once session 3 is in; A7 for the Library tests.
- **Owns:** `packages/core/src/library-ui/dom/{shell,detail,header}/`, `packages/core/src/library-ui/dom/{index,mountLibraryUi}.ts`, `packages/core/src/writing/allProjects/dom/` except `dom/tray/` and `dom/detail/detailRequests.ts`, `packages/vscode/src/writing/allProjects/webview/`.
- **Runs with:** session 3.
- **Last session:** if session 3 is already committed when this one ends, run `finish` on everything the plan touched (docs: `documents/apps/vscode.md` All projects section), then delete `documents/plans/all-projects-detail/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Shell seams: frame options, generic tabs, exported builders | behaviour | implementer (sonnet) | Library tests pass unchanged | [ ] |
| 4.2 | Project detail pane | behaviour | implementer (fable), `ui-design` skill first, after 4.1 | A3–A5 in a headless check | [ ] |
| 4.3 | Tasks: webview CSS imports and pane prefs | task | main thread, after 4.2 | vscode typecheck | [ ] |
| 4.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 4.1 — Shell seams

- **Goal:** the Library frame and tabs can host a non-paper detail without copying them.
- **Read only:** `documents/plans/all-projects-detail/research/library-shell.md`, `packages/core/src/library-ui/dom/shell/frame.ts`, `shell/index.ts`, `detail/tabs/tabBar.ts`, `detail/detailMarkup.ts`, `detail/detailPane.ts` lines 25-70, `packages/core/src/library-ui/dom/mountLibraryUi.ts` lines 45-60, `packages/core/src/library-ui/state/prefs.ts` lines 1-40, `packages/core/src/library-ui/dom/index.ts`.
- **Decided:**
  - `buildFrame(host, prefs: PanePrefsPort, options: { withSidebar: boolean; withCitationMap: boolean; detailLabel: string })`; `FrameSlots.citationMap` is `HTMLElement | null`. `PanePrefsPort` = `load()`/`save(patch)` over `PanePrefs` (the four pane keys), declared in `state/prefs.ts`; the Library `PrefsPort` satisfies it. `showPane`/`togglePane` take `PanePrefsPort`.
  - `tabBarHtml(tabs: { id: string; label: string; badge?: string; dot?: boolean }[], active: string)`; the paper pane builds its list from `DetailTab` and calls it. The output HTML for the Library stays byte-identical.
  - Export `buildFrame`, `togglePane`, `tabBarHtml`, and `section`, `kv`, `iconBtn`, `muted`, `loading` from `library-ui/dom/index.ts` (through `shell/index.ts` and `detail/index.ts`).
- **Done when:** every test under `packages/core/__tests__/library-ui/dom/` passes unchanged; core typecheck passes; the browser and vscode packages typecheck (they call `mountLibraryUi`, not `buildFrame`; confirm by grep).
- **Do not touch:** CSS, paper rendering, `writing/`.

## 4.2 — Project detail pane

- **Goal:** the All projects page has the right pane described in the research entry.
- **Read only:** `research/ui-shapes.md` (section Pane), `research/data-shapes.md` (Detail), `packages/core/src/writing/allProjects/dom/mountAllProjects.ts`, `dom/allProjectsHeader.ts`, `dom/projectMenu.ts`, `dom/detail/detailRequests.ts`, `packages/core/src/writing/allProjects/deadlineText.ts`, `packages/core/src/library-ui/dom/head/paperHead.ts` (class names only), `packages/core/src/library-ui/dom/styles/library-tabs.css` lines 1-40.
- **Decided:**
  - New files in `dom/detail/`: `mountProjectDetail.ts` (render on selection/detail change, delegated `data-action` clicks, fold state kept in memory with Location folded first), `projectDetailHead.ts`, `overviewTab.ts`, `citationsTab.ts`, `versionsTab.ts`, `projectDetailText.ts` (meta line, limit sentence, build status text). Each under 200 lines, functions under 50.
  - `mountAllProjects(root, channel: { transport; prefs: PanePrefsPort })` builds the page with `buildFrame` (options in the research entry) and puts the existing header and list in its slots; the header gets the panel-right toggle at its right end.
  - Actions post `open`, `preview`, `build`, `openLog`, `setTarget`; the "…" button opens the same entries as the row menu.
  - New styles (limit bar, build dot in the pane, citation and version rows) go in `dom/styles/all-projects.css` from tokens only; the file stays under 200 lines, else split it by responsibility and add the `package.json` export in this package.
- **Done when:** core typecheck and tests pass; a headless check of the page (recipe: `documents/apps/README.md#verifying-changes`, webview harness) with a fake transport shows the pane for a selected project, the toggle collapses it, and a reload keeps the width; report screenshots' paths.
- **Do not touch:** `dom/tray/`, `projectList.ts`, `projectRowView.ts`, library-ui files beyond what 4.1 exported.

## 4.3 — Tasks (main thread)

- `packages/vscode/src/writing/allProjects/webview/main.ts`: import `library-detail.css` and `library-tabs.css` after `library-list.css`.
- `webview/allProjectsChannel.ts`: return `{ transport, prefs }`, with `prefs` from the webview-state prefs in `packages/vscode/src/libraryWebview/webviewChannel.ts` (import it; if it is not separable, move the prefs factory to `packages/vscode/src/webviewMessaging/` in this change).
- `pnpm --filter @labshelf/vscode typecheck`.
