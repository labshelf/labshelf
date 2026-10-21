sha: c078dbc
files: packages/core/src/collab/mirror/**, packages/core/src/collab/model/**, packages/core/src/collab/state/**, documents/contracts/collaboration.md
source: scout

## Disk to doc (`mirror/reconcile/textMirror.ts:15-61`)

- A watcher or rescan calls `queue.request(path, true)`. After `stableMs` (300, `projectMirror.ts:16`) `PathQueue` (`pathQueue.ts:74-148`) runs `reconcilePath` (`projectMirror.ts:133-155`). It dispatches to settings, untracked, text or blob.
- `reconcileText` runs these checks in order:
  1. Disk equals doc: set `known` and `bases`.
  2. Disk hash equals `known`: write the doc.
  3. The file is unsettled: request it again.
  4. `awaitsSync` (no updates yet): keep the local file.
  5. Otherwise call `mergedWithDoc`: when `known` is undefined or the doc hash equals `known`, the disk text is taken whole. Otherwise it is a three-way merge with `bases.get(path)`; with no base, the disk text is taken and a WARN is logged. Then `replaceFileText(doc, next, DISK_ORIGIN)` (`model/fileText.ts:198-225`).
- `known` is a persisted `PersistedMap<string>` from path to SHA-256 (`state/collabStore.ts:376-381`, `StateMapName` in `state/collabStateStorage.ts:13`: `known | relay-cursors | relay-held`). `bases` is an in-memory `Map` (`mirrorContext.ts:26`) that is lost on restart.
- `hashOf` and `writeMirrored` are in `mirrorContext.ts:37-47`. `writeMirrored` is the only disk write (atomic, gated by ownership) and sets `known` and `bases`.

## Doc to disk

- `attach(path)` (`projectMirror.ts:104-111`) requests a reconcile on every doc update whose origin is not `DISK_ORIGIN`. Restores use another origin (`restore/applyRestoredFiles.ts:20-40`).

## Blobs (`mirror/reconcile/blobMirror.ts:7-57`)

- The index entry is `{kind:"blob", hash}`. When the disk changes from `known`, the blob is stored and the entry replaced, last writer wins. An old blob restored on disk therefore replaces the current one.

## Untracked files (`mirror/reconcile/untrackedFile.ts:9-34`)

- A new file under the project is added to the share, so a sync tool's conflict copy would spread to every member.

## Index doc (`model/shareIndex.ts:234-267`)

- Maps: `share`, `files` (path to `{kind, hash?}`), `settings`, `comments`, `relays` (Y.Array). Contract table: `collaboration.md:164-178`. There is no per-file version list.
- `.labshelf/` is not shared except `checklist.json` (`sharedPaths.ts`). `comments.json` is written through `context.disk` (`projectMirror.ts:143-147`). The lease file goes through `LibraryFileSystem` (`ownership/leaseFile.ts`).
- There is no persistent device id. The lease `owner` is a UUID per run (`ownership/acquireFolderLease.ts:36`).

## Device-local state

- Port `CollabStateStorage`. Node: `node/state/nodeCollabStorage.ts` under `<state>/libraries/<key>/collab/<share>/`. Browser: `packages/browser/src/storage/collaboration/collabDb.ts` (IndexedDB `labshelf-collab` v1; stores `docs`, `updates`, `maps`, `blobs`; `maps` is keyed by name, so a new map name likely needs no schema bump; this is unverified).

## Limits and tests

- `mirror/reconcile/` holds 7 files plus index; the cap is 8. `textMirror.ts` has 61 lines and `mirrorContext.ts` 58.
- Tests are in `packages/core/__tests__/collab/mirror/`: `projectMirror.test.ts` (restart plus offline edit at :177), `twoMirrors.test.ts`, `mirrorFixture.ts` (`openMirror`, `STABLE_MS`=40, `recordingDisk`, `FakeClock`, `FakeNetwork`, `FakeRelay`) and `mirrorFiles.ts`.
