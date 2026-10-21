# Session 2b — Divergent versions outside a share

- **Goal:** Outside a share, a silent overwrite between two devices is detected from the write records and merged, or asked.
- **Starts from:** session 2 committed.
- **Ends with:** A5 passes as a test; `sync.md` describes the divergence merge and the version store.
- **Owns:** `packages/core/src/writing/merge/` and its tests, the VS Code save hook files under `packages/vscode/src/` and their tests, `documents/contracts/sync.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2b.1 | App save records and divergence merge | contract | implementer (opus) | A5 | [ ] |
| 2b.2 | Review | — | `architecture-reviewer` on the diff (sync) | no blocking finding | [ ] |
| 2b.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2b.1 — Outside a share: app save records and divergence merge

- **Goal:** Apply D7 for project text files outside a share.
- **Read only:**
  - `documents/plans/stale-copies/research/library-conflicts.md`
  - `packages/core/src/writing/merge/node/projectConflictScan.ts`
  - `packages/core/src/writing/merge/node/projectCopyMerge.ts:40-81`
  - `packages/core/src/writing/merge/mergeBaseStore.ts`
  - `packages/core/src/library/externalChange/changeBatch.ts`
  - `packages/vscode/src/storage/data/externalChangeWatcher.ts`
  - grep `onDidSaveTextDocument` in `packages/vscode/src`
- **Decided:**
  - **Stored versions.** Extend the merge base store into a per-file store of recent version texts (newest 20) keyed like today: `<state>/libraries/<key>/merge-bases/`. Rename by responsibility if the name stops fitting. Delete what it replaces; do not keep two stores.
  - **Saves.** A save of a project text file in VS Code (`onDidSaveTextDocument`, files under a non-shared project) and LabShelf's own project writes append `{hash, parent: <hash on disk before the save>, by: "app"}` to this device's record and store the text.
  - **Divergence.** On an external change batch, for each changed project text file outside a share, compare the disk text's record `parent` with this device's last stored hash for that path.
    - When they differ, and both the parent and the last version are stored texts, merge with base = parent, local = this device's last version and other = disk.
    - A clean merge is written atomically, stored, recorded and shown with an INFO notice.
    - A conflicted merge goes to the existing conflict prompt as a conflict.
    - A file with no record or with a matching parent behaves as today.
  - Shared projects are skipped here. The mirror owns them (D10).
  - **Contract.** `sync.md` gets a "Divergent versions" paragraph. Update the merge base rule ("a base is written only on first sight and after a single-copy merge") to the new store rules.
- **Done when:**
  - The failing tests come first, with temp dirs and two device ids writing one folder in turn.
  - A5: a silent overwrite is detected and merged; an overlap asks the user.
  - The core and vscode tests and typecheck pass.
- **Do not touch:** the collab mirror (2.2), conflict-copy name detection (session 3).
