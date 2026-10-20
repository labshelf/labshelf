# Session 5 — Remove the in-tab panes, re-scope CSS, docs

- **Goal:** the Library and All projects tabs lose their internal right pane in both apps, and the docs describe the Details surface.
- **Starts from:** session 4 committed, with Details working in both apps.
- **Ends with:** A6, A8 and A9.
- **Owns:** `packages/core/src/library-ui/dom/`, `packages/core/src/writing/allProjects/dom/`, `packages/core/src/details/dom/`, `packages/vscode/src/` (webview prefs and entries), `packages/browser/src/library-page/` (prefs and CSS), and `documents/apps/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 5.1 | Delete in-tab panes and re-scope CSS | task | implementer (sonnet) | typecheck, test and build of all packages pass | [ ] |
| 5.2 | Finish: dead code, comments, docs, review | — | `finish` skill | findings fixed | [ ] |
| 5.3 | Check, commit, delete the plan | — | `check`, `git commit` | gate passes | [ ] |

## 5.1 — Delete in-tab panes

- **Goal:** remove every trace of the detail pane inside the tabs.
- **Read only:** `documents/plans/details-side-pane/research/core.md`, `packages/core/src/library-ui/dom/shell/frame.ts`, `dom/mountLibraryUi.ts:40-80`, `dom/header/listHeader.ts:20-50`, `dom/menu/tagInputFocus.ts`, `dom/state/prefs.ts:40-55`, `dom/styles/library-ui.css:15-45`, `packages/core/src/writing/allProjects/dom/mountAllProjects.ts:90-140`.
- **Decided:**
  - **Frame:** `buildFrame` drops `detailLabel`, the detail sash and `aside.detail-pane`. `FrameSlots.detail` goes, and `PaneName` becomes `"sidebar"`. If `togglePane` and `showPane` are left with one caller, simplify them.
  - **Mounts:** `mountLibraryUi` no longer calls `mountDetailPane`. `mountAllProjects` no longer mounts `mountProjectDetail` or the header detail toggle. `listHeader` loses `data-act="detail"`. `tagInputFocus` stops calling `showPane(detail)`; in Details the pane is already visible.
  - **CSS:** move every `.ls-library .detail-pane`, `.sash-detail`, `.detail-collapsed` and `library-detail.css` rule to the `.ls-details` scope, delete the in-tab variants, and drop the `ls-library` class from the Details root that session 2 added. Do the same for the All projects detail styles under `.ls-all-projects`.
  - **Prefs:** `detailWidth` and `detailCollapsed` leave the core `PanePrefs` and the VS Code webview prefs. Only the browser `PagePrefs` keeps them, for the page pane. `detailTab`, `citeFormat` and `secCollapsed` stay for Details.
  - Search every package, including HTML, CSS and manifests, for leftovers, and delete them.
- **Done when:** `pnpm -r typecheck`, `pnpm -r test` and both apps' `build` pass, and a grep for `detail-pane`, `sash-detail` and `detailCollapsed` finds only Details code and the browser page pane.
- **Do not touch:** `documents/contracts/` (done in session 1).

## 5.2 — Finish

Run the `finish` skill on everything this plan touched. Docs to update: in `documents/apps/vscode.md`, :8 and :12 (the detail pane in the tab and its toggle) and :40 ("Cited in" in the detail pane); in `documents/apps/browser.md`, :50-56 (page layout) and :92. Describe the Details view, the secondary side bar and the minimum VS Code 1.106 in vscode.md, and the page-level pane in browser.md.

## 5.3 — End

Run `check`, commit the Owns, then delete `documents/plans/details-side-pane/`. It is a migration, so it does not meet the archive bar.
