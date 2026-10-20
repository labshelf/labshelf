# Session 2 — Derived views, .ics, protocol and server

- **Goal:** core turns a Space plus the Library and the projects into the view models every surface shows, and serves them to a page over a typed protocol.
- **Starts from:** session 1 committed.
- **Ends with:** `core/src/spaces/{view,protocol}/`, `serveSpaces.ts`, `spacesHostPort.ts` with tests (logic behind A1–A9, A11, A13).
- **Owns:** `packages/core/src/spaces/{view,protocol}/`, `packages/core/src/spaces/{serveSpaces,spacesHostPort}.ts`, `packages/core/src/spaces/index.ts`, their tests.

Runs with session 3 (disjoint Owns). Codebase facts: [research/codebase-core.md](../research/codebase-core.md).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | View models and .ics | behaviour | implementer (sonnet) | tests pass | [ ] |
| 2.2 | Protocol, server, host port | contract | implementer (opus) | tests pass | [ ] |
| 2.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

2.2 runs after 2.1.

## 2.1 — View models and .ics

- **Goal:** pure functions from `(space, library snapshot, projects, today)` to what the screens show.
- **Read only:** `packages/core/src/spaces/index.ts`; `documents/contracts/spaces.md`; `packages/core/src/library/model/types.ts:4-44`; `packages/core/src/model/paperRecord.ts:9-40`; `packages/core/src/writing/allProjects/{projectRow.ts,deadlineText.ts}`.
- **Decided:** `packages/core/src/spaces/view/`, runtime-neutral, one file per view:
  - `SpaceProjectInfo` `{ projectId, title, format?, mainFile?, deadline?, checklist?: { done, total }, available }`, supplied by the host (2.2).
  - Catalog row: id, name, purpose, reading `{ done, total }`, next open date `{ date, title } | null`, counts `{ papers, projects }`, `shared: false`, `unreadable?`; filter by text (name, purpose) and by All / Personal / Shared.
  - Overview: timeline entries sorted by date, each `past | today | future`, with progress for `read` (Done / listed) and `project` (checklist) goals; linked project deadlines added as `deadline` entries marked `fromProject`; papers in focus with status; linked projects resolved or `available: false`.
  - Papers tree: Space folders nested, each reference resolved to title, authors, year, status, or `missing`.
  - Sidebar rows: the same tree as the Papers tree, for every readable Space, plus unreadable ones by id.
  - `.ics`: one all-day `VEVENT` per date entry and project deadline; RFC 5545 escaping, CRLF, 75-octet folding, stable `UID` `<space id>-<entry id>@labshelf`.
- **Done when:** tests in `packages/core/__tests__/spaces/view/`, seen failing first: progress counts; today split at local midnight; missing paper and project; next date skips done tasks; text filter; `.ics` folding and escaping of `,;\` and newlines. Core typecheck and test pass.
- **Do not touch:** `spaces/model/`, `spaces/store/`.

## 2.2 — Protocol, server, host port

- **Goal:** a page talks to any host through one typed protocol; `serveSpaces` answers it from the store and a host port.
- **Read only:** `packages/core/src/writing/allProjects/protocol/messages.ts`, `protocol/parseAllProjectsMessage.ts`, `serveAllProjects.ts`, `projectLibraryPort.ts` (the pattern to copy); `packages/core/src/library-ui/protocol/transport.ts:6-10`; `packages/core/src/spaces/index.ts`; `research/store-api.md`.
- **Decided:**
  - `SpacesHostPort`: `library()` and `onLibraryChange`; `projects(): Promise<SpaceProjectInfo[]>` and `onProjectsChange`; `openPaper(id)`, `selectPaper(id)` (Details), `openProject(projectId)`, `openSpace(id, tab?)`, `openCatalog()`, `saveFile(name, text)` (the `.ics`). Add a core helper that builds `SpaceProjectInfo[]` from `ProjectRow`s plus a checklist reader, so apps only glue.
  - Page → host: `ready { view: "catalog" } | { view: "space", id }`, every store mutation by name, `openPaper`, `selectPaper`, `openProject`, `openSpace`, `exportIcs`, `listPapers`, `listProjects` (pickers run in the page with core `quickPick`).
  - Host → page: `catalog { rows }`, `space { overview, papers, glossary, projects }`, `papers { items }`, `projects { items }`, `error { action, message }`.
  - `parseSpacesMessage` rejects unknown types and malformed fields (a trust boundary: webview and page input).
  - `serveSpaces(endpoint, { store, port, logger, today })` re-posts the open view on store, library and project changes, coalesced; each failed action logs and posts `error` with a label.
- **Done when:** tests first in `packages/core/__tests__/spaces/protocol/` and `serveSpaces.test.ts` over `createLoopbackTransport`: the parser rejects bad input; a mutation reaches the store and re-posts; an outside store change re-posts once; a throwing port posts `error` and logs. Core typecheck and test pass.
- **Do not touch:** `spaces/view/` beyond exports.

## 2.3 — Check, commit

`check` on Owns. Commit: `Add Spaces views, protocol and server`.
