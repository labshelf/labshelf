# Plan: Details as a side pane outside the tabs

Status: draft
Size: 5 sessions. They cover, in order: the core protocol and contract, the core surface, VS Code wiring, browser wiring, and removing the in-tab panes.

## 1. Goal

Paper and project details leave the Library and All projects tabs and become a single **Details** surface that sits beside every tab and follows the last selection. In VS Code, Details is a native view in the secondary side bar, so it stays visible next to the reader or an editor. On the browser library page, Details is a page-level right pane that persists across the internal tabs.

## 2. Decisions

- [ ] **D1** One core DOM surface, `mountDetails`, in `packages/core/src/details/dom/`. It shows one paper, several papers (the existing multi view) or one project, and the last selection wins. With nothing selected it shows one empty state. It reuses `mountDetailPane` (paper) and `mountProjectDetail` (project) unchanged in behaviour. Reason: it is the same UI in two apps, so it belongs in core (AGENTS.md §2).
- [ ] **D2** Details talks to its host over one channel. Messages are an envelope around the two existing protocols, `{channel:"library", msg}` and `{channel:"projects", msg}`, plus one host-to-Details message, `{type:"details.show", target}`. Here `target` is `{kind:"paper", ids}`, `{kind:"project", id}` or `null`. Hosts serve the library channel with their existing library-ui host code and the projects channel with core `serveAllProjects`. The new contract is `documents/contracts/details-host.md`. Reason: no host logic is duplicated, and both apps already serve both protocols.
- [ ] **D3** `paper.selected` carries `ids: string[]` instead of `id | null`, where an empty array means no paper is selected. This lets Details show the multi-selection. It is a change to `documents/contracts/library-ui-host.md`.
- [ ] **D4** All projects posts a new message, `project.selected {id | null}`, when its selection changes and when it becomes ready.
- [ ] **D5** The selection hub is runtime-neutral core code in `packages/core/src/details/selectionHub.ts`. It keeps the last target per source (`"list"`, `"projects"`, `"reader"`). `publish(source, target)` shows the target, and `activate(source)` shows that source's last target again, so focusing a tab brings back its own selection. Closing a source does not clear Details. Both apps use it, and it ships with a test.
- [ ] **D6** In Details, picking a row in the multi-selection list narrows the selection inside Details only. Actions that need the list (opening a folder) are sent to the host, and the host forwards them to the list tab. Session 1 picks the message and writes it into the contract.
- [ ] **D7** VS Code adds a view container, `labshelfDetails` under `viewsContainers.secondarySidebar`, holding the webview view `labshelf.details` with `retainContextWhenHidden`. `engines.vscode` and `@types/vscode` move to `^1.106.0`, the first version where that contribution point is stable, and the esbuild webview target moves with them. VS Code handles collapse and resize, so the view has no toggle of its own.
- [ ] **D8** VS Code selection sources are the list tab (`paper.selected`), All projects (`project.selected`) and the active reader tab (its paper). The sidebar tree keeps reaching Details through the list tab, as `paper.selected` already does. When an editor tab becomes active, it calls `activate` for its source.
- [ ] **D9** On the browser, `pageShell` adds a right pane with a sash. Its width and collapsed state are stored in `PagePrefs`, and a panel-right toggle sits at the end of the workspace tab bar. The library view and the All projects tab are the sources, and switching tabs calls `activate`. The browser reader is a separate browser tab, so it is not a source.
- [ ] **D10** The in-tab panes are deleted in both apps. `buildFrame` loses its detail slot and sash, the list header and the All projects header lose their detail toggles, and `mountLibraryUi` and `mountAllProjects` no longer mount detail panes. The detail CSS is re-scoped from `.ls-library` to `.ls-details`.

## 3. Acceptance

- [ ] **A1** VS Code 1.106 or later shows the LabShelf Details view in the secondary side bar after install.
- [ ] **A2** Select a paper in the Library tab and Details shows it. Activate a reader tab of another paper and Details shows that paper. Activate the Library tab again and Details shows the list's selection.
- [ ] **A3** Select a project in All projects and Details shows its Overview, Citations and Versions.
- [ ] **A4** Select several papers in the list and Details shows "N papers selected" with the batch actions.
- [ ] **A5** Changing the status, tags or note in Details updates the list tab, and a change made in the list updates Details.
- [ ] **A6** In both apps, the Library and All projects tabs have no right pane and no detail toggle.
- [ ] **A7** On the browser library page, the right pane keeps its content while you switch tabs, and its width and collapsed state survive a reload.
- [ ] **A8** The hub and protocol-guard tests fail without the change, and `pnpm -r typecheck` and `pnpm -r test` pass.
- [ ] **A9** `documents/contracts/` (details-host, library-ui-host), `documents/apps/vscode.md` and `documents/apps/browser.md` describe the new layout.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-core-protocol.md](sessions/1-core-protocol.md) | Details protocol, hub, contracts | `packages/core/src/details/` (not `dom/`), core library-ui and allProjects protocol, `documents/contracts/` | alone |
| 2 | [sessions/2-core-surface.md](sessions/2-core-surface.md) | `mountDetails` surface | `packages/core/src/details/dom/` | alone (after 1) |
| 3 | [sessions/3-vscode-view.md](sessions/3-vscode-view.md) | Details view in the secondary side bar | `packages/vscode/` | alone (manifest) |
| 4 | [sessions/4-browser-pane.md](sessions/4-browser-pane.md) | page-level Details pane | `packages/browser/` | alone (after 3) |
| 5 | [sessions/5-remove-tab-panes.md](sessions/5-remove-tab-panes.md) | in-tab panes deleted, docs | core library-ui and allProjects `dom/`, both apps' webview entries, `documents/apps/` | alone |
