# Session 2 — list columns and file tray

- **Goal:** the All projects list shows Title (+ venue chip), Engine, Cites, Build and Modified, and the tray labels each file's role and fact, with a log row and `+ Add file`.
- **Starts from:** session 1 committed.
- **Ends with:** A1, A2 (core side; the facts fill in once session 3 serves `detail`).
- **Owns:** `packages/core/src/writing/allProjects/deadlineText.ts`, `packages/core/__tests__/writing/allProjects/deadlineText.test.ts`, `packages/core/src/writing/allProjects/dom/{projectList,projectRowView,mountAllProjects}.ts`, `packages/core/src/writing/allProjects/dom/tray/`, `packages/core/src/writing/allProjects/dom/detail/{index,detailRequests}.ts` (new), `packages/core/src/writing/allProjects/dom/styles/all-projects.css`, `packages/core/__tests__/writing/allProjects/dom/`.
- **From session 1:** the row build type is `ProjectBuildState` (not `BuildState`, which the reader already exports); `ProjectRow` has `cites`, `unresolvedCites`, `build?`, `target?`; `all-projects.css` still has the `.col-open` rules and the old `--cols` grid track, to remove here.
- **Runs with:** session 3.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | Columns and venue chip | behaviour | implementer (sonnet) | A1 in a DOM check | [ ] |
| 2.2 | Detail requests and tray roles, facts, log row, Add file | behaviour | implementer (sonnet), parallel with 2.1 | A2 in a DOM check | [ ] |
| 2.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

UI, CSS and copy get no tests (AGENTS.md §6); the one exception is the days-left text, which is logic.

## 2.1 — Columns and venue chip

- **Goal:** row cells and heads match the decided columns.
- **Read only:** `documents/plans/all-projects-detail/research/ui-shapes.md` (section List), `research/all-projects-page.md`, `packages/core/src/writing/allProjects/dom/projectList.ts` lines 30-50, `dom/projectRowView.ts`, `dom/styles/all-projects.css`, `packages/core/src/writing/allProjects/projectRow.ts`, `packages/core/src/library/format/elapsedTime.ts` lines 30-46, `packages/core/src/ui/dom/tokens.css` (token names only: grep `--ls-` for success, warning, error, mono font).
- **Decided:** the research section. Put the days-left text in a pure helper `packages/core/src/writing/allProjects/deadlineText.ts` (runtime-neutral, root of the domain; header "Says how many days are left until a project's deadline."): `deadlineText(target, now): { text: string; tone: "normal" | "near" | "passed" } | undefined`; session 4 reuses it for the pane.
- **Done when:** `packages/core/__tests__/writing/allProjects/deadlineText.test.ts` (41 d normal, 14 d near, today "0 d" near, yesterday passed, no deadline, invalid → undefined) fails first, then passes; core typecheck passes; `projectList.ts` and `projectRowView.ts` stay under 200 lines.
- **Do not touch:** `dom/tray/`, `mountAllProjects.ts`, library-ui files.

## 2.2 — Detail requests and tray

- **Goal:** the page keeps the selected project's detail and the tray uses it for roles and facts, plus the log and Add file rows.
- **Read only:** `research/ui-shapes.md` (section Tray), `research/data-shapes.md` (Detail, Port and protocol), `packages/core/src/writing/allProjects/dom/mountAllProjects.ts`, `dom/tray/projectTray.ts`, `dom/tray/projectExpansion.ts`, `dom/tray/projectFileTree.ts`, `packages/core/src/library-ui/dom/list/tray/fileFacts.ts` lines 1-20 (`TrayEntry`), `packages/core/src/ui/dom/widgets/quickInput.ts` (signature only).
- **Decided:**
  - New `dom/detail/detailRequests.ts` ("Keeps the last detail of each project and asks the host for the selected one."): `createDetailRequests(post): { request(id): void; receive(msg): void; get(id): ProjectDetail | undefined; error(id): string | undefined; onChange(listener): () => void }`; `mountAllProjects` calls `request` on select and, for the selected id, on every `projects` message, and routes `detail` messages to `receive`; the tray repaints on `onChange` for the expanded id. `dom/detail/index.ts` exports it.
  - `paintProjectTray` takes the row and `ProjectDetail | undefined`; without a detail it shows names and the Main role only. Role and fact text per the research section, built in a new `dom/tray/projectTrayFacts.ts`.
  - The log row and `+ Add file` row are `TrayEntry` rows; the Add file row uses the tray's existing action-row styling if there is one, else `buildTrayRow` with an add icon and no type label. Opening the log posts `openLog`; Add file posts `createFile` with the trimmed input; an empty input does nothing.
  - Do not edit `all-projects.css`; 2.1 owns it. If a style is missing, report it.
- **Done when:** core typecheck passes; `mountAllProjects.ts` stays under 200 lines; report the remaining lines of every touched file.
- **Do not touch:** `projectList.ts`, `projectRowView.ts`, CSS, library-ui files.
