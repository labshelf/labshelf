# Session 2a — Writing tab

- **Goal:** the library page shows a Writing tab listing the projects of the library folder and this device's registered external folders.
- **Starts from:** sessions 1a and 1b committed (the browser project store exists).
- **Ends with:** the tab is mounted on the library page and fed by the project store. Feeds A1: "A project synced from VS Code shows in the browser's Writing tab with its PDF." Session 3 checks A1 in a headless run with a fake bridge host.
- **Owns:** `packages/core/src/library-ui/dom/writing/`, `packages/browser/src/library-page/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2a.1 | Core Writing tab component | behaviour | implementer (opus), `ui-design` skill | typecheck of core | [ ] |
| 2a.2 | Library page glue: the tab and its host | behaviour | implementer (sonnet) | typecheck of browser | [ ] |
| 2a.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2a.1 — Core component

- **Goal:** a DOM component listing writing projects, each with its PDF (opens in the reader), its reading list and a disabled "Edit" (enabled by the browser-editor plan).
- **Read only:** `packages/vscode/src/activation/registration/registerWritingView.ts:1-40` (what VS Code shows); `packages/core/src/writing/project/projectEntry.ts:1-16`; `packages/core/src/writing/readingList/readingList.ts:1-47`; `packages/core/src/library-ui/dom/index.ts` (barrel, for placement); `packages/core/src/library-ui/hostConfig.ts`.
- **Decided:**
  - TRAP: the VS Code Writing view is a native tree view, not a DOM component. The "same core component" goal is met by this component plus the shared project model; moving VS Code onto it is out of scope.
  - API in `packages/core/src/library-ui/dom/writing/index.ts`: `mountWritingTab(root, host)`; the host interface lists projects and opens a PDF.
  - Tokens, icons and vocabulary from core (AGENTS.md section 2); folder, paper, Unread / Reading / Done wording.
- **Done when:** `pnpm --filter @labshelf/core typecheck`; files at most 200 lines. No test (UI layout and copy).
- **Do not touch:** other `library-ui/dom/` folders; the VS Code app.

## 2a.2 — Library page glue

- **Goal:** the library page shows a Writing tab beside the library, fed by the browser project store.
- **Read only:** `packages/browser/src/library-page/router.ts:1-30`; `packages/browser/src/library-page/main.ts:1-47`; `packages/browser/src/library-page/host/hostController.ts:1-86`; `packages/browser/src/storage/projects/index.ts` (session 1a: `listBrowserProjects(): Promise<ProjectEntry[]>`, `readProjectFile(id, path)`); `packages/browser/src/reader/index.ts:1-60` (opening the reader).
- **Decided:** the PDF is the project's built PDF in its folder; a project without one shows "No PDF yet".
- **Done when:** `pnpm --filter @labshelf/browser typecheck`. No test (simple glue).
- **Do not touch:** `packages/browser/src/storage/`, `packages/browser/src/background/`, sibling sessions' paths (`side-panel/`, `content/`).
