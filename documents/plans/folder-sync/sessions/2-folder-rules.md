# Session 2 — Folder rules: device-local state, conflict copies, watchers

- **Goal:** a library folder synced by any tool stays consistent: no device-local files inside it, conflict copies are merged or surfaced, external changes and half-written files never lose papers.
- **Starts from:** session 1 committed (no Drive sync code exists).
- **Ends with:** A3, A5, A4 core part (the conflict UI is session 3); `documents/contracts/sync.md` is the folder-sync contract.
- **Owns:** `packages/core/src/library/**`, `packages/core/src/writing/project/node/projectRegistryFile.ts`, `packages/core/__tests__/library/**`, `packages/vscode/src/storage/data/externalChangeWatcher.ts`, `packages/vscode/src/activation/libraryLifecycle/externalChangeHandling.ts`, `packages/terminal/src/library/libraryWatcher.ts`, their tests, `documents/contracts/{sync,library-format}.md`, `documents/plans/folder-sync/research/sync-tool-files.md`.

Context: the user's sync tool (Dropbox, Google Drive for desktop, OneDrive, iCloud Drive, Nextcloud, Syncthing, rclone) syncs the library folder; LabShelf calls no cloud API. Facts: `documents/plans/folder-sync/research/library-setup.md`. Designs: `documents/plans/folder-sync/research/folder-rules-decisions.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2.1 | Research sync-tool file names | — | general-purpose (sonnet), web | entry written | [ ] |
| 2.2 | Device-local state out of the library | contract | implementer (opus) + `architecture-reviewer` | A5, tests | [ ] |
| 2.3 | Conflict copies: detect, merge sidecars, resolve | contract | implementer (opus) + `architecture-reviewer` | A4 core tests | [ ] |
| 2.4 | Watchers: noise, partial writes, root, projects | behaviour | implementer (sonnet) | A3 tests | [ ] |
| 2.5 | Folder-sync contract text | task | main thread | `sync.md` rewritten | [ ] |
| 2.6 | Check, commit | — | `check` on Owns, `git commit` | gate passes | [ ] |

2.1 first; 2.2 and 2.3 in parallel (disjoint: `library/node/deviceState/**` vs `library/conflicts/**`; each edits only its own section of `library-format.md`); 2.4 after 2.3; 2.5 last.

## 2.1 — Research sync-tool file names

- **Goal:** write `documents/plans/folder-sync/research/sync-tool-files.md` (header per `documents/plans/TEMPLATE/research/README.md`, ≤4,000 chars): for Dropbox, Google Drive for desktop, OneDrive, iCloud Drive, Nextcloud, Syncthing and rclone bisync, the exact conflict-copy name pattern with examples and the temporary/partial file names written while downloading, each with a source URL.
- **Done when:** each tool has a pattern, or "not found" with the sources tried.

## 2.2 — Device-local state out of the library

- **Goal:** `.research/index.sqlite`, `logs/`, `openalex/`, `staging/` and `projects.json` leave the library folder.
- **Read only:** `research/folder-rules-decisions.md` ("Device-local state"), `research/library-setup.md`, `core/src/library/layout.ts`, `core/src/library/node/{cacheDirectory,sharedConfigFile}.ts`, `core/src/writing/project/node/projectRegistryFile.ts`, `documents/contracts/library-format.md` (layout).
- **Decided:** as in the decisions entry. Tests first: paths per platform and env, registry read/write in the state dir.
- **Done when:** tests pass; `pnpm -r typecheck`, `pnpm -r test`; `library-format.md` says which files are synced and which are device-local.

## 2.3 — Conflict copies: detect, merge sidecars, resolve

- **Goal:** core detects sync-tool conflict copies, merges sidecar conflicts automatically and resolves the others on request.
- **Read only:** `research/folder-rules-decisions.md` ("Conflict copies"), `research/sync-tool-files.md`, `documents/contracts/library-format.md` (sidecar, paper folders), `core/src/library/layout.ts`, `core/src/library/node/atomicWrite.ts`, `core/src/ports/sidecarPort.ts`.
- **Decided:** as in the decisions entry. Tests first for every tool pattern, the merge rules and each resolution.
- **Done when:** tests pass; `library-format.md` has a "Conflict copies" section.

## 2.4 — Watchers: noise, partial writes, root, projects

- **Goal:** VS Code and the terminal pick up a sync tool's changes robustly.
- **Read only:** `research/folder-rules-decisions.md` ("Watchers"), `research/sync-tool-files.md`, `core/src/library/externalChange/noiseFilter.ts`, `vscode/src/storage/data/externalChangeWatcher.ts`, `vscode/src/activation/libraryLifecycle/externalChangeHandling.ts`, `terminal/src/library/libraryWatcher.ts`, the 2.3 scan entry point.
- **Decided:** as in the decisions entry. Tests first for the noise names, the parse-failure rule and root loss.
- **Done when:** tests pass; vscode and terminal typecheck + test.

## 2.5 — Folder-sync contract text

- **Steps (main thread):** rewrite `documents/contracts/sync.md`: the folder rule; synced vs device-local files and conflict copies (link the `library-format.md` sections, do not repeat); tolerance for partial writes and a missing root; the browser reaches the folder through the bridge (`bridge.md`, written in session 4). Present tense.
