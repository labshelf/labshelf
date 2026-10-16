# Session 3a — share a project through the exchange file

- **Goal:** two authors exchange a project through one Drive file, and each sync reports who else changed it recently.
- **Starts from:** session 2 committed (`mergeText`, the base-store port and `CoauthorActivity` exist).
- **Ends with:** a coauthor who picks the exchange file once syncs the project both ways (D8); `SyncResult.coauthors` names coauthors who changed the project in the last 10 minutes (the seam session 3c reads). No A-id: A5 needs this plus session 3c.
- **Owns:** `packages/core/src/sync/` (including `index.ts`), `packages/core/__tests__/sync/`, `documents/contracts/sync.md`, `packages/vscode/src/sync/`, `packages/vscode/src/activation/registration/registerSyncCommands.ts`, `packages/vscode/__tests__/sync/`, the `labshelf.shareProject` and `labshelf.pickSharedProject` entries in `packages/vscode/package.json`

Runs alone: it changes `packages/vscode/package.json`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3a.1 | Exchange port, Drive exchange adapter, contract | contract | implementer (opus), tests first → architecture-reviewer | exchange tests | [ ] |
| 3a.2 | Coauthor activity in the run result | behaviour | implementer (sonnet), test first | activity tests | [ ] |
| 3a.3 | "Share project" and the pick step in VS Code | behaviour | implementer (opus) | typecheck | [ ] |
| 3a.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3a.1 — Exchange port and Drive adapter

- **Goal:** one exchange file per project, created and shared by the owner's app and picked once by the coauthor, carries each side's changes; each sync merges the other author's changes from it.
- **Read only:** `documents/contracts/sync.md` 15–64; `packages/core/src/sync/provider/remoteProvider.ts` 1–53; `packages/core/src/sync/drive/googleDriveProvider.ts` 1–60; `packages/core/src/sync/drive/googleDriveClient.ts` 150–189; `packages/core/src/sync/engine/pipeline/syncEngine.ts` 60–192; the `mergeText` and base-store seams from session 2.
- **Decided:**
  - Why an exchange file: under `drive.file`, grants are per person and per file; sharing or picking a folder gives the coauthor's app nothing, and a file one app creates in a shared folder stays invisible to the other. A file the coauthor picks once in Google Picker stays readable and writable across later updates by either side, and its `lastModifyingUser` names the other author. The full `drive` scope is out.
  - A core port in `core/src/sync/exchange/` with one Drive adapter; another transport (such as GitHub) is not built.
  - The exchange file's content format and the local record of which file belongs to which project (under `.research/sync/`, never synced) are written into sync.md#projects in this package, before code.
  - Text files merge with `mergeText` against the base store; binary files keep both.
  - Open: where the coauthor's Picker page runs (a browser page signed in to Google, with an API key and the Picker API on the LabShelf Cloud project). The main thread settles it and writes the answer here before delegating: `Picker page: <answer>`.
- **Done when:** tests first with a fake Drive: create, share, read the other side's changes, merge; a missing or unreadable exchange file is reported and logged, never deleting local files. Core typecheck and sync tests pass.
- **Do not touch:** `packages/core/src/writing/`, `packages/core/src/reader/`, `packages/browser`, `packages/terminal`.

## 3a.2 — Coauthor activity

- **Goal:** each run reports who else changed a shared project in the last 10 minutes (D4).
- **Read only:** `packages/core/src/sync/engine/syncTypes.ts` 1–90; `packages/core/src/sync/drive/googleDriveProvider.ts` 14–30; the exchange adapter from 3a.1.
- **Decided:** the source is the exchange file's `lastModifyingUser` and `modifiedTime` (add them to the Drive list fields). Fills `SyncResult.coauthors?: CoauthorActivity[]` with `CoauthorActivity = {projectId: string; name: string; email?: string; modifiedTime: string}`. An entry is reported only when the modifier is not the signed-in user and the change is within 10 minutes of the run.
- **Done when:** core tests pin the 10-minute window and the own-user exclusion.
- **Do not touch:** `packages/vscode/src/writing/`.

## 3a.3 — Share project in VS Code

- **Goal:** the owner runs "Share project" on a Writing view project; the coauthor opens the pick step once.
- **Read only:** `packages/vscode/src/activation/registration/registerSyncCommands.ts` 1–29; `packages/vscode/src/sync/adapter/syncController.ts` 55–165; `packages/vscode/package.json` 21–40 and 536–560; the 3a.1 port.
- **Decided:** commands `labshelf.shareProject` and `labshelf.pickSharedProject` live in `packages/vscode/src/sync/share/` and are registered from `registerSyncCommands.ts`; these are the only manifest entries this session adds. Errors show a toast and log with context. Process or disk-path code follows `architecture.md#node-code-in-vs-code`.
- **Done when:** `pnpm --filter @labshelf/vscode typecheck` passes. No test: this is command glue over the tested port.
- **Do not touch:** `packages/vscode/src/writing/`, `registerWritingView.ts`, `extension.ts`.
