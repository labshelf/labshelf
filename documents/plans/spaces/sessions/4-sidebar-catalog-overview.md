# Session 4 — Sidebar section, Add to Space, catalog, Space frame and Overview

- **Goal:** the core DOM for the Spaces sidebar section, the paper menu entry, the All Spaces catalog, the Space page frame and its Overview tab.
- **Starts from:** sessions 2 and 3 committed.
- **Ends with:** core components the apps can mount (A1–A8 and A11 in core; the hand check comes after sessions 6–7).
- **Owns:** `packages/core/src/library-ui/dom/sidebar/` (new `spaces/` subfolder plus the `SectionId` and mount option), the library-ui paper menu and its protocol message, `documents/contracts/library-ui-host.md`, `packages/core/src/spaces/dom/{index.ts,catalog,frame,overview,papers,glossary,positioned,chat}/`, their tests.

Runs alone. Codebase facts: [research/codebase-core.md](../research/codebase-core.md). Design: [research/ui-design.md](../research/ui-design.md).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Sidebar Spaces section | behaviour | implementer (sonnet) | tests pass | [ ] |
| 4.2 | "Add to Space…" in the paper menu | contract | implementer (sonnet) | tests pass | [ ] |
| 4.3 | All Spaces catalog | behaviour | implementer (sonnet) | tests pass | [ ] |
| 4.4 | Space frame and Overview | behaviour | implementer (opus) | tests pass | [ ] |
| 4.5 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

All four run in parallel.

## 4.1 — Sidebar Spaces section

- **Goal:** an optional third sidebar section: All Spaces, each Space, its folders and references.
- **Read only:** `packages/core/src/library-ui/dom/sidebar/{mountLibrarySidebar.ts,sidebarSections.ts,sidebarProjects.ts,sidebarRows.ts,sidebarView.ts}`; the sidebar-rows view in `packages/core/src/spaces/view/`; `research/ui-design.md`; `research/mockup-reuse.md` (`sidebar/spaces.js`, `sidebar/sidebar.css`).
- **Decided:** `SectionId` gains `"spaces"`; `mountLibrarySidebar` takes `spaces?: SidebarSpaceActions` and the section appears only when it is given (like `projects`). Code in `sidebar/spaces/`. Actions: `openCatalog`, `openSpace(id, folder?)`, `openPaper(id)`, `newSpace`, `renameSpace`, `deleteSpace` (confirm), `newFolder`, `renameFolder`, `deleteFolder`, `dropPapers(spaceId, folder, paperIds)`, `removeReference`. Data in through `setSpaces(rows)`. Heading action: New Space. Row menus use `showMenu`. Collapse state joins the existing collapsed set.
- **Done when:** jsdom tests: without `spaces` nothing renders; rows nest; Enter opens; drop of paper ids calls `dropPapers`; delete asks first. Core typecheck and test pass.

## 4.2 — "Add to Space…" in the paper menu

- **Goal:** the Library's paper menu offers "Add to Space…" for one or many papers when the host supports Spaces.
- **Read only:** `documents/contracts/library-ui-host.md`; the library-ui paper menu (find the "Move to folder" entry under `packages/core/src/library-ui/dom/`) and the library-ui protocol message types and parser next to it.
- **Decided:** a new page → host message `paper.addToSpace { ids }`, documented in `library-ui-host.md`; the entry shows only when the host's capabilities say `spaces: true`. The host shows the Space picker (session 6, 7).
- **Done when:** tests first: the parser accepts and rejects the message; the entry is hidden without the capability. Core typecheck and test pass.

## 4.3 — All Spaces catalog

- **Goal:** `mountSpacesCatalog(el, end)` over the 2.2 protocol: header with New Space, search, All / Personal / Shared filter, one row per Space.
- **Read only:** `packages/core/src/spaces/protocol/` and `view/` catalog row; `packages/core/src/writing/allProjects/dom/mountAllProjects.ts` (page shape); `research/ui-design.md`; `research/mockup-reuse.md` (`catalog/catalog.js`, `catalog/catalog.css`).
- **Decided:** row: name, purpose, reading progress, next date, counts as links (papers → Papers tab, projects → Overview), "You" member chip. Shared filter shows its empty state (sharing comes later). Unreadable Space: row with its path and reason. No avatar picker.
- **Done when:** jsdom tests over a loopback: filter and search narrow rows; New Space posts the mutation; row click posts `openSpace`. Core typecheck and test pass.

## 4.4 — Space frame and Overview

- **Goal:** `mountSpace(el, end, { id, tab })`: header, six inner tabs, and a working Overview.
- **Read only:** `packages/core/src/spaces/protocol/`, `view/` overview; `research/ui-design.md`; `research/mockup-reuse.md` (`space/{header,overview}.js`, `space/{space,overview}.css`).
- **Decided:** header: name and purpose editable inline, "You" chip, Share positioned. Inner tabs Overview, Papers, Notes, Discussions, Discover, Glossary; the tab change is reported through an `onTab` callback so apps keep it in tab state. Overview blocks: Dates and goals (add with a dialog: kind, title, date, papers picker for `read`, project picker for `project`; tick; edit; remove; Export .ics), Projects (link via picker, unlink, open), Papers in focus, Members ("You"), Discussions (positioned card), Since your last visit (empty state). Create `papers/`, `glossary/`, `positioned/` and `chat/` each with an `index.ts` exporting a mount that renders the empty state; session 5 replaces them.
- **Done when:** jsdom tests: the add-date dialog posts the right `kind` fields; ticking posts `setDone`; Export posts `exportIcs`; `onTab` fires. Core typecheck and test pass.

## 4.5 — Check, commit

`check` on Owns. Commit: `Add the Spaces sidebar section, catalog and Overview`.
