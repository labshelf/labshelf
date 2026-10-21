# Session 1 — Old versions never revert a share

- **Goal:** The mirror writes the current text over an old version on disk; an outside edit merges against the version it started from, across restarts.
- **Starts from:** plan approved.
- **Ends with:** A1, A2, A3 pass as core tests; `collaboration.md` describes the `written` map, the `versions` and `bases` state and the reconcile rules.
- **Owns:** `packages/core/src/collab/model/`, `packages/core/src/collab/state/`, `packages/core/src/collab/mirror/`, `packages/core/__tests__/collab/{model,state,mirror}/`, `packages/browser/src/storage/collaboration/`, `documents/contracts/collaboration.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1.1 | `written` map and stored versions | contract | implementer (opus) | tests below pass | [ ] |
| 1.2 | Reconcile rules: stale, merge base, blobs | contract | implementer (opus) | A1, A2, A3 | [ ] |
| 1.3 | Review | — | `architecture-reviewer` on the session diff (sync) | no blocking finding | [ ] |
| 1.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 1.1 — `written` map and stored versions

- **Goal:** Add the shared list of versions mirrors wrote, and the device-local texts of recent versions plus a persisted merge base.
- **Read only:**
  - `documents/plans/stale-copies/research/collab-mirror.md`
  - `documents/contracts/collaboration.md` lines 92–111 (device-local state) and 164–178 (docs and index)
  - `packages/core/src/collab/model/shareIndex.ts:230-270`
  - `packages/core/src/collab/state/collabStore.ts:360-390`
  - `packages/core/src/collab/state/collabStateStorage.ts`
  - `packages/browser/src/storage/collaboration/collabDb.ts`
- **Decided:**
  - **Index doc map `written`** (`doc.getMap("written")`): path → `Y.Array` of `{hash: string, at: number}` (ms since the epoch).
    - Accessor `indexWritten(doc)` sits next to `indexFiles`. Function `recordWritten(doc, path, hash, at)` appends unless the newest entry has the same hash, then trims the array to the newest 200 (constant `WRITTEN_PER_PATH`).
    - `writtenHashes(doc, path): ReadonlySet<string>`.
    - A path that leaves `files` also leaves `written`.
  - **State maps.** Add `versions` and `bases` to `StateMapName`.
    - `versions`: path → JSON `[{hash, text}]`, the newest 50 (`VERSIONS_PER_PATH`). Expose `rememberVersion(path, hash, text)` and `storedVersions(path)`.
    - `bases`: path → the last text disk and doc agreed on. It replaces the in-memory `bases` map in `mirrorContext.ts:26`; delete that map.
  - **Browser.** Bump `collabDb.ts` only if its `maps` store needs it; no migration (no users yet).
  - **Contract.** Add `written` to the index table, and `versions` and `bases` to the device-local state list.
- **Done when:**
  - The failing tests are written first: `__tests__/collab/model/shareIndexWritten.test.ts` (append, dedupe of the newest, trim to 200, removal with the file) and a state test that `versions` and `bases` survive closing and reopening `nodeCollabStorage`.
  - `pnpm --filter @labshelf/core typecheck` passes, and `pnpm --filter @labshelf/browser typecheck` too if the browser changed.
- **Do not touch:** the reconcile files (1.2).

## 1.2 — Reconcile rules: stale, merge base, blobs

- **Goal:** Apply D3 in the mirror.
- **Read only:**
  - `documents/plans/stale-copies/research/collab-mirror.md`
  - `packages/core/src/collab/mirror/reconcile/textMirror.ts`
  - `packages/core/src/collab/mirror/reconcile/mirrorContext.ts`
  - `packages/core/src/collab/mirror/reconcile/blobMirror.ts`
  - `packages/core/src/collab/mirror/projectMirror.ts:60-185`
  - `packages/core/__tests__/collab/mirror/mirrorFixture.ts`
- **Decided:**
  - **`writeMirrored`** calls `recordWritten`, `rememberVersion` and sets `bases`. So does the disk-equals-doc branch.
  - **New order in `reconcileText`**, applied after the existing equal, `known` and unsettled checks:
    1. `awaitsSync`: unchanged.
    2. The disk hash is in `writtenHashes`: it is an old version. Call `writeMirrored(docText)` and log INFO "Wrote the shared text over an old version on disk" with `{path, diskHash}`.
    3. Otherwise it is an edit. The base is chosen in this order:
       - the persisted `bases` text, when the disk text started from it, meaning `bases` is the stored version with the most equal lines;
       - else the stored version (`storedVersions`) with the most equal lines to the disk text.
       Then `mergeText({base, local: docText, other: diskText})` and `replaceFileText(doc, merged, DISK_ORIGIN)`.
    4. With no stored version, keep today's WARN path.
  - **Line similarity.** `lineSimilarity(a, b): number` = equal lines over the larger line count, with `textMerge`'s line split. It goes in a new file in core `writing/merge/`, because session 3 reuses it outside shares.
  - **Blobs.** A disk blob whose hash is in `writtenHashes` and differs from the index entry is an old version. Write the entry's blob back and leave the index unchanged.
  - **Size limits.** `mirror/reconcile/` has a cap of 8 files, so new files go in a subfolder named by responsibility, for example `mirror/reconcile/versions/`.
  - **Contract.** Replace the rule at `collaboration.md:109` ("a file whose disk hash differs from its known hash was changed outside the share") with the D3 rules.
- **Done when:**
  - The failing tests are written first in `__tests__/collab/mirror/staleVersions.test.ts`, with two mirrors through `FakeRelay`:
    - A1: an old text is put back on member X's disk, the doc and the peer keep the new text, and X's file is rewritten.
    - A2: the same for a blob.
    - A3: X edits an old version, restarts and reconnects; only X's edit is added.
  - The existing `__tests__/collab` suites pass.
  - `pnpm --filter @labshelf/core typecheck` passes.
- **Do not touch:** anything outside Owns, except the new `writing/merge/` file and its test.
