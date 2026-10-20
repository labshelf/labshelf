# Plan: Spaces in VS Code and the browser

Status: draft
Size: 8 sessions — a new on-disk format, a new core domain, about ten new UI surfaces and the wiring for two apps

## 1. Goal

A user groups papers and writing projects into Spaces from VS Code and from the browser extension. A Space keeps its own folders of references, its dates and goals, its papers in focus and its glossary, without copying anything in the Library. The screens that need a model, a feed or other people (Research chat, Discover, Discussions, Notes, Share, activity) are built as positioned layouts so that later plans fill them without moving anything. The idea and the mockup: [spaces.md](../../ideas/spaces.md), [spaces-mockup/](../../ideas/spaces-mockup/index.html). The terminal app and "Insert from LabShelf" are out of scope.

## 2. Decisions

- [ ] **D1** Everything shared is in `packages/core/src/spaces/`: model and file format (`model/`), reads and writes over `LibraryFileSystem` (`store/`), derived views and `.ics` (`view/`), page protocol and server (`protocol/`, `serveSpaces.ts`), and the UI (`dom/`). Apps hold only panels, tab kinds, the host port and the composition. This follows the All projects page (`writing/allProjects/`).
- [ ] **D2** On disk, a Space is `spaces/<space id>/space.json` plus `spaces/<space id>/glossary.json` under the library root. The contract is a new `documents/contracts/spaces.md`, and `library-format.md` Layout gains `spaces/`. A space id is a slug of the name made unique by a numeric suffix, and it never changes. Both files keep unknown keys on write and are written atomically. A corrupt file never throws: the Space shows as unreadable, with its path.
- [ ] **D3** `space.json` holds `version`, `name`, `purpose`, `createdAt`, `papers` (`{ id, folder?, addedAt, focus? }`), `folders` (`{ id, name, parent? }`), `projects` (project ids from `labshelf.yaml`) and `dates`. Space folders are virtual: a reference sits in at most one Space folder or at the Space root. Removing a reference never touches `papers/`, and deleting a Space folder moves its references to its parent.
- [ ] **D4** `dates` entries are `{ id, kind, title, date, done? , paperIds?, projectId? }` with `kind` one of `task` (a checkbox), `deadline` (a marker), `read` (progress = papers Done / papers listed) and `project` (progress = the project's checklist). A linked project's `target.deadline` appears on the timeline without being stored. `.ics` export is built in core; the app saves the file (save dialog in VS Code, download in the browser).
- [ ] **D5** A paper or project id that does not resolve stays in the file and shows "Not in your Library" / "Not on this device" with Remove. It is never pruned automatically, because sync may still bring it.
- [ ] **D6** Sharing is out. Share is shown disabled with a tooltip; Members lists only "You" with initials; the catalog's Shared filter shows its empty state; "Since your last visit" shows its empty state. `space.json` has no members field; the sharing plan adds it. No avatar dependency.
- [ ] **D7** Positioned only, with no data, no storage and no network: the Notes tab (Space notes and Paper notes groups, empty states), the Discussions tab (Topics / Decisions / Tasks, topic list and thread layout), the Discover tab (feed filters, arXiv alerts and Watch cards), the Research chat panel (context, suggestions, composer), the Glossary suggestions column and "Generate labshelf-glossary.tex". Their controls are disabled with a tooltip that names what is missing; nothing pretends to work and no sample data ships.
- [ ] **D8** The Glossary keeps manual terms in full: `{ id, term, symbol?, definition, source?: { paperId, page? } }`, with add, edit and delete. Two terms with the same symbol show a conflict notice on both.
- [ ] **D9** One core page serves both the catalog ("All Spaces") and a Space, over a core protocol and `serveSpaces` that talks to a `SpacesHostPort`. VS Code has a singleton catalog `WebviewPanel` and one panel per Space, both from one `spaces` bundle. The browser has the tab kinds `spaces` and `space`. The Space sub-tabs (Overview, Papers, Notes, Discussions, Discover, Glossary) are inner tabs of one editor tab, and the open sub-tab is part of the tab's state.
- [ ] **D10** The core sidebar gets an optional third section `spaces` (opt-in like `projects`): All Spaces, each Space, its folders and their references. Its code goes in a subfolder, because `library-ui/dom/sidebar/` already holds 8 files. The paper menu gains "Add to Space…" (a quick pick). The browser shows the section whenever the Library section is shown, with no new setting.
- [ ] **D11** Research chat: in VS Code, a webview view `labshelf.researchChat` in the `labshelfDetails` secondary-sidebar container. In the browser, the right pane shows either Details or Research chat, switched by the titlebar buttons.
- [ ] **D12** A Space references a project by the id in its `labshelf.yaml`. Resolving it to a `ProjectRow` (whose `id` is a host key) goes through the host port, so external projects resolve only on the device that registered them.
- [ ] **D13** The mockup stays in `documents/ideas/` while positioned screens remain. Session 8 moves the built behaviour from `ideas/spaces.md` into `documents/` and leaves only the unbuilt parts there.

Open (blocks approval): none. The user decided on 2026-10-20: local Spaces with positioned sharing, Notes positioned, manual Glossary in full, no avatars.

## 3. Acceptance

- [ ] **A1** In VS Code and the browser, New Space (sidebar or catalog) asks for a name, writes `spaces/<id>/space.json` as the contract says, and the Space appears in the sidebar and the catalog.
- [ ] **A2** "Add to Space…" on a paper, and Add papers on the Papers tab, add references; one paper sits in two Spaces, and `papers/` is unchanged.
- [ ] **A3** Space folders: create, rename, delete (references move to the parent) and move a reference between folders; the sidebar mirrors the Papers tab.
- [ ] **A4** Remove from Space leaves the paper in the Library. Delete Space moves `spaces/<id>/` to the trash and touches no paper or project.
- [ ] **A5** Dates and goals: add a task, a deadline, a read goal and a project goal; tick a task; progress follows reading status and the project checklist; a linked project's deadline shows; the Today marker sits between past and future; Export .ics writes a file that a calendar imports.
- [ ] **A6** Projects: link and unlink; the card shows format, main file, deadline and checklist progress; Open opens the normal project.
- [ ] **A7** Papers in focus: mark and unmark from the Papers tab; Overview lists them with their status.
- [ ] **A8** Catalog: search, All / Personal / Shared filters, each row shows reading progress, the next date, the counts and "You"; opening a Space keeps the catalog tab.
- [ ] **A9** Glossary: add, edit and delete terms with an optional symbol and source; they survive a reload; a shared symbol shows the conflict notice.
- [ ] **A10** Notes, Discussions, Discover, Research chat, Share, Members, Since your last visit and Glossary suggestions match the mockup layout; their controls are disabled with a tooltip; no request leaves the app.
- [ ] **A11** A reference to a missing paper or project shows its state and Remove.
- [ ] **A12** In VS Code, a sync conflict copy of `space.json` or `glossary.json` is listed for resolution with keep mine / keep the other.
- [ ] **A13** An outside change to `space.json` (a sync tool, a hand edit) refreshes the open views in both apps.
- [ ] **A14** Every colour, size and icon comes from core tokens and the icon set; light and dark both read well; the sidebar section and the inner tabs work from the keyboard with correct roles.
- [ ] **A15** `pnpm -r typecheck` and `pnpm -r test` pass, the terminal package included.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-contract-and-store.md](sessions/1-contract-and-store.md) | contract, model, store, conflict copies | `documents/contracts/spaces.md`, `documents/contracts/library-format.md`, `packages/core/src/spaces/{model,store}/`, `packages/core/src/library/{layout.ts,conflicts/}`, `packages/core/src/writing/merge/node/libraryConflictScan.ts` | alone |
| 2 | [sessions/2-views-and-protocol.md](sessions/2-views-and-protocol.md) | derived views, `.ics`, protocol, server, host port | `packages/core/src/spaces/{view,protocol}/`, `packages/core/src/spaces/serveSpaces.ts`, `spacesHostPort.ts` | 3 |
| 3 | [sessions/3-ui-foundations.md](sessions/3-ui-foundations.md) | UI design pass, new widgets and icons | `packages/core/src/ui/`, `research/ui-design.md` | 2 |
| 4 | [sessions/4-sidebar-catalog-overview.md](sessions/4-sidebar-catalog-overview.md) | sidebar section, Add to Space, catalog, Space frame and Overview | `packages/core/src/library-ui/dom/sidebar/`, the library-ui paper menu, `documents/contracts/library-ui-host.md`, `packages/core/src/spaces/dom/` | alone |
| 5 | [sessions/5-papers-glossary-shells.md](sessions/5-papers-glossary-shells.md) | Papers and Glossary tabs, positioned tabs, chat panel | `packages/core/src/spaces/dom/{papers,glossary,positioned,chat}/` | alone |
| 6 | [sessions/6-vscode.md](sessions/6-vscode.md) | VS Code wiring | `packages/vscode/` | alone |
| 7 | [sessions/7-browser.md](sessions/7-browser.md) | browser wiring | `packages/browser/` | alone |
| 8 | [sessions/8-docs-and-finish.md](sessions/8-docs-and-finish.md) | docs, finish, hand check | `documents/`, whole diff | alone |
