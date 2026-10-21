# Session 4 — Deleted annotations stay deleted

- **Goal:** A sync tool's copy of `data.json` no longer brings a deleted annotation back. Each annotation merges by its own `updatedAt`, not by the whole file's mtime.
- **Starts from:** plan approved; runs alongside session 1.
- **Ends with:** A8 passes; `library-format.md` describes the `deleted` field and the merge rules. Then, if it is the last session, run `finish` on everything the plan touched and delete this plan directory.
- **Owns:**
  - `packages/core/src/reader/sidecar/` and its tests;
  - `packages/core/src/model/annotation.ts`;
  - `packages/core/src/library/conflicts/sidecarMerge.ts` and `node/sidecarConflictMerge.ts`, with their tests;
  - the sidecar section of `documents/contracts/library-format.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | `deleted` markers and per-annotation merge | contract | implementer (sonnet) | A8 | [ ] |
| 4.2 | Review | — | `architecture-reviewer` on the diff (on-disk format) | no blocking finding | [ ] |
| 4.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 4.1 — `deleted` markers and per-annotation merge

- **Goal:** Apply D9.
- **Read only:**
  - `documents/plans/stale-copies/research/library-conflicts.md` (Sidecars)
  - `documents/contracts/library-format.md` lines 277–320
  - `packages/core/src/reader/sidecar/paperData.ts`
  - `packages/core/src/reader/sidecar/paperDataStore.ts:120-150`
  - `packages/core/src/library/conflicts/sidecarMerge.ts`
  - `packages/core/src/library/conflicts/node/sidecarConflictMerge.ts:55-75`
  - `packages/core/src/model/annotation.ts`
- **Decided:**
  - **Field.** `PaperData` gains `deleted: {id: string; deletedAt: string}[]`, an ISO time like `updatedAt`.
    - It is serialised after `reading` and omitted when empty, so a file with no deletions keeps today's bytes.
    - `normalizePaperData` reads it defensively: invalid entries are dropped.
  - **Delete.** `PaperDataStore.deleteAnnotation` removes the annotation and appends `{id, deletedAt: now}`. Every write drops markers older than 90 days (`DELETION_MARKER_DAYS`).
  - **Merge.** `mergeSidecars`:
    - the annotations are the union by id, and for an id in both, the larger `updatedAt` wins;
    - the markers are the union by id, keeping the larger `deletedAt`;
    - an annotation is dropped when a marker for its id has `deletedAt >= updatedAt`, so an edit after the deletion keeps the annotation (and drops that marker);
    - `theme` and `reading` still follow the newer file by mtime.
  - **Readers** see only `annotations`. No reader changes are needed beyond the type.
  - **Contract.** In `library-format.md`, replace "A deleted annotation may come back" with these rules. Add `deleted` to the `data.json` example. There is no migration: the app has no users, and an old file without the field reads as no deletions.
- **Done when:**
  - The failing tests come first:
    - a deletion beats an older copy;
    - an edit after the deletion wins;
    - two edits merge per annotation by `updatedAt` regardless of file mtime;
    - markers older than 90 days are dropped;
    - a file without deletions serialises byte-identically to today.
  - The core tests and typecheck pass.
- **Do not touch:** anything outside Owns.
