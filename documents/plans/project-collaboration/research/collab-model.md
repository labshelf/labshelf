sha: 3159f508
files: documents/contracts/library-format.md (labshelf.yaml, .labshelf/*), packages/core/src/writing/project/export/projectFiles.ts, packages/core/src/writing/history/node/snapshotFiles.ts, documents/plans/folder-sync/research/folder-rules-decisions.md
source: planner's design from the repo and the user's decisions, 2026-10-17

# Collaboration model (sessions 2–5)

## Identity and keys
- A shared project has a random 128-bit `projectKey` and an opaque `shareId` = first 16 bytes of HKDF(projectKey, "share-id"), hex. Derived keys (HKDF-SHA-256): `content` (AES-GCM for updates, snapshots, blobs), `awareness`, `room` (trystero room id and password), `relay` (relay token). WebCrypto only, so the code is runtime-neutral.
- Invite link: `labshelf://join#v1.<shareId>.<base64url projectKey>.<base64url relay list>`, also printable as text. Anyone holding it is an editor; removing someone = owner rotates the key and re-invites the rest (no roles).
- Keys live device-local (VS Code `SecretStorage`), never in the project folder. `labshelf.yaml` gets `shared: <shareId>` (a key added to `library-format.md`) so a second device of the same user shows "Shared project: paste the invite to reconnect".

## Docs per project
- One `Y.Doc` per text file (key = POSIX relative path) plus one `index` doc: `files: Y.Map<path, {kind: text|blob, hash?}>`, `settings: Y.Map` (shared `labshelf.yaml` keys), `comments: Y.Map<threadId, thread>`. Renames and deletes are index edits.
- Shared files: the export filter of `core/src/writing/project/export/projectFiles.ts` (no `.git/`, build output, built PDFs) minus `.labshelf/` except `checklist.json`. Text = valid UTF-8 with a known text extension (same list as writing-2 D3); everything else is a blob.
- Blobs: content-addressed by `sha256Hex` (`core/src/hash`), fetched on demand from peers or the relay in 64 KiB encrypted chunks; reuses the history store's hashing.
- `labshelf.yaml` is not a text doc: `folder`, `archived`, `trashed` and `id` are per user. The shared keys (`format`, `main`, `engine`, `bibliography`, `title`, `figures`, `values`, `check`, `target`, `papers`) sync through `settings`; each client writes them into its own file with the existing rewrite rules (keeps comments and unknown keys).
- `labshelf.bib` is a shared text file. TRAP: each user's generator writes it from their own library; a collaborator without a paper would delete its entry. In a shared project the generator only adds and updates entries, never removes one another member added.

## Device-local state
- Yjs state per project (`<stateDir>/libraries/<key>/collab/<shareId>/`: last snapshot + pending update log) and blob cache. Not inside the library, because the user's sync tool would conflict it.

## Disk mirror
- Doc → disk: write a file only when disk text differs from the doc text, atomically (`library/node/atomicWrite.ts`).
- Disk → doc: a watcher change whose text differs from the doc is diffed (character diff) and applied as one Yjs transaction with origin `disk` (YAOS DiskMirror).
- Two devices of one user: both are peers and write the same text, so the sync tool sees identical files. A conflict copy the sync tool still makes is merged by writing-2's three-way merge into the file; the resulting disk change enters the doc as a diff.

## Join
- Joiner pastes the invite → LabShelf creates `projects/<id>/` in the joiner's library (id collisions take the usual suffix), syncs the index, writes files, then offers to import the papers the project lists (`papers:` DOIs, the `labshelf install` path).

## Comments
- Live: thread anchors are Yjs relative positions (start, end) in the file's doc, plus `{quote, prefix, suffix}`.
- Disk: `.labshelf/comments.json` is written from the `comments` map (writing-2 3b.1 format); the quote anchor re-anchors when no relative position resolves.

## Awareness
- y-protocols awareness, encrypted with the `awareness` key: `{name, colour, file, anchor, head}`. Name from the LabShelf user name setting; colour from the core token palette.
