# Session 1a — Projects in the browser store

- **Goal:** the browser lists and reads writing projects through the native bridge and exposes a project store API.
- **Starts from:** plan approved; plan `folder-sync` sessions 4–5 committed: the browser reaches library and project folders on disk through a Native Messaging bridge; projects are plain folders synced by the user's own tool.
- **Ends with:** the project store seam below exists and is tested. Feeds A1: "A project synced from VS Code shows in the browser's Writing tab with its PDF."
- **Owns:** `packages/browser/src/storage/projects/`, `packages/browser/__tests__/storage/projects/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1a.1 | Project store API over the native bridge | contract | implementer (opus), tests first; then architecture-reviewer | seam tests pass | [ ] |
| 1a.2 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 1a.1 — Project store over the bridge

- **Goal:** the browser lists every project of the library folder (`<library>/projects/<id>/`) and the device's registered external folders, and reads and writes their files, through the bridge client.
- **Read only:** the browser's bridge client from plan `folder-sync` (its `index.ts`; find it with `rg -l "connectNative" packages/browser/src`); `packages/core/src/writing/project/projectEntry.ts:1-16`.
- **Decided:**
  - The browser keeps no copy of project files: every read and write goes through the bridge, which runs on the device that holds the folders.
  - The external-project registry is device-local and read by the bridge; the browser has no folder choice of its own.
  - Seam this session provides, in `packages/browser/src/storage/projects/index.ts`: `listBrowserProjects(): Promise<ProjectEntry[]>`, `readProjectFile(id, path)`, `writeProjectFile(id, path, bytes)`. Sessions 2a, 2c, 2d and 2e call it.
  - A bridge failure (host missing, folder unreadable) is logged through the injected `ILogger` with the project and path, and reported to the caller; it never deletes a file.
  - If the bridge lacks a call this needs (list projects, read or write a project file), report it back: the bridge belongs to plan `folder-sync`.
- **Done when:** tests under `packages/browser/__tests__/storage/projects/`, written first with a fake bridge, pin: `listBrowserProjects` reads `labshelf.yaml` of each internal and registered project; a read and a write reach the bridge with the project's path; a bridge failure is logged and reported. `pnpm --filter @labshelf/browser typecheck && pnpm --filter @labshelf/browser test`; files at most 200 lines.
- **Do not touch:** the bridge and its host; core; other apps; `packages/browser/src/background/`; session 1b's paths (`platform/`, core `reader/`).
