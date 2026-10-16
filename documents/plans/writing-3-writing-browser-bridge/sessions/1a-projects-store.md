# Session 1a — Projects in the browser store

- **Goal:** the browser syncs the `projects` namespace into IndexedDB and exposes a project store API.
- **Starts from:** plan approved; the writing-sync work that adds the `projects` namespace and the base store with three-way merge is committed.
- **Ends with:** the browser syncs the `projects` namespace; the project store seam below exists and is tested; `documents/contracts/sync.md` says the browser syncs all three namespaces. Feeds A1: "A project synced from VS Code shows in the browser's Writing tab with its PDF."
- **Owns:** `packages/browser/src/storage/`, `packages/browser/src/sync/`, `documents/contracts/sync.md`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1a.1 | Browser joins the `projects` namespace; project store API | contract | implementer (opus), tests first; then architecture-reviewer | sync fakes pass for the browser; seam tests pass | [ ] |
| 1a.2 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 1a.1 — Projects namespace in IndexedDB

- **Goal:** the browser's sync run includes every project in `LabShelf Projects`, stored under `projects/<id>/` in the IndexedDB `files` store, with its merge base in IndexedDB.
- **Read only:** `packages/core/src/sync/coordinator/types.ts:20-45` (`SyncTarget.listProjects`); `packages/core/src/sync/engine/syncTypes.ts:72-87` (`SyncProject`, `projectsOnlyOnDrive`); `packages/core/src/sync/coordinator/syncRun.ts:57-90`; `packages/browser/src/sync/browserSync.ts:1-43`; `packages/browser/src/storage/idb/schema.ts:1-44`; `packages/browser/src/storage/indexedDbFileSystem.ts:1-89`; `packages/terminal/src/sync/terminalSync.ts:35-45` (how another app lists projects); `documents/contracts/sync.md:21-43`.
- **Decided:**
  - The Writing tab shows the projects synced from Drive, so the browser has no folder choice: a project reported in `projectsOnlyOnDrive` is adopted under `projects/<id>/` and downloaded on the next run.
  - `SyncProject.root` is the store prefix `projects/<id>`.
  - The base store is the port the writing-sync work defines, implemented over an IndexedDB store; a schema change goes through `storage/idb/upgrade.ts`.
  - `BROWSER_SYNC_ROOTS` in core stays as is unless the engine needs a `projects` root; then report that one line back, because core is not in Owns.
  - Seam this session provides, in `packages/browser/src/storage/projects/index.ts`: `listBrowserProjects(): Promise<ProjectEntry[]>`, `readProjectFile(id, path)`, `writeProjectFile(id, path, bytes)`; files live under `projects/<id>/` in the `files` store. Sessions 2a, 2c, 2d and 2e call it.
- **Done when:** tests under `packages/browser/__tests__/storage/projects/` and `__tests__/sync/`, written first, pin: an adopted project downloads on its first run and never deletes on Drive; a local edit uploads; an edit on both sides merges through the base; `listBrowserProjects` reads `labshelf.yaml` of each stored project. `sync.md` (Projects section and its namespace table) names the browser. `pnpm --filter @labshelf/browser typecheck && pnpm --filter @labshelf/browser test`; files at most 200 lines. `architecture-reviewer` reviews the diff against `sync.md` (sync and Drive writes).
- **Do not touch:** the sync engine and merge in core; other apps; `packages/browser/src/background/`; session 1b's paths (`platform/`, core `reader/`).
