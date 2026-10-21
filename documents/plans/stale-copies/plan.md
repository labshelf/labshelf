# Plan: Old copies and divergent versions from sync tools

Status: draft
Size: 5 sessions. Each changes a different contract and can be tested apart: the share mirror, the folder write records, divergence outside a share, conflict copies found by content, and annotation deletions.

## 1. Goal

A sync tool (Drive, Dropbox, Syncthing or any other) can put an old or divergent file into a library or project folder. LabShelf must not let that file silently revert someone's work. In a shared project, an old file restored by a member's cloud must not delete a peer's edits through the relay. Outside a share, two devices that edited the same file must end with both edits, or with a clear question to the user, whatever the tool does: overwrite, create a copy with any name, or leave both.

## 2. Decisions

- [ ] **D1** The share index doc gains a `written` map: path → a list of `{hash, at}`. Every mirror appends the hash of each text or blob version it writes to disk or agrees with on disk. The list keeps the newest 200 entries per path. It travels through the relay, so every device knows the versions every other mirror wrote. Core `collab/model`.
- [ ] **D2** Device-local state gains `versions`: path → the texts of the newest 50 versions this device wrote or agreed. It also persists the merge base, which today lives only in memory. Core `collab/state`, with one port for Node and the browser.
- [ ] **D3** Share reconcile rules for a disk text that differs from the doc:
  - its hash is in `written` → it is an old version: the mirror writes the doc text back and logs INFO;
  - otherwise it is an edit: the base is the stored version the disk text derives from (D6 record parent, else the stored version with the most equal lines), and the edit is a three-way merge into the doc.
  Blobs use the same `written` check, with no merge. Core `collab/mirror`.
- [ ] **D4** Each device has a stable random device id per library, kept in device-local state.
- [ ] **D5** Each device writes its own record file, `<folder>/.labshelf/writes/<device id>.json`: per path, the newest 50 entries of `{hash, parent, by: "mirror" | "app", at}`. The record is written before the file it describes. Because every device writes only its own file, sync tools never make conflict copies of the records. `.labshelf/` stays out of the share.
- [ ] **D6** In a shared project, a disk text whose hash is in any device's record with `by: "mirror"`, but not yet in `written`, is a mirror write still in flight through the relay. The mirror never reads it into the doc. It waits with no time limit until the hash appears in `written` or the doc reaches it, and a newer disk change ends the wait. A hash found in no record and no list waits for one relay round trip (ask for updates and wait for the answer) before it counts as an edit.
- [ ] **D7** Outside a share, the app records each save of a project text file in D5 with `by: "app"` and `parent` = the hash on disk before the save. VS Code records editor saves; LabShelf's own writes record too. When a file changes on disk and its record names a parent that is not this device's last version of that file, the two versions diverged and this device's version was overwritten. LabShelf then three-way merges the parent, this device's version and the disk text:
  - a clean merge is written, with an INFO notice;
  - a conflicted merge asks the user, as a conflict copy does today.
  A change with no record behaves as today.
- [ ] **D8** A new text file in a project counts as a copy of file Y when:
  - its name matches a known conflict pattern (as today), or
  - its hash is a recorded version of Y, or
  - at least 60% of its lines equal Y's and it has the same extension.
  For a match by content the user sees "<X> appeared in <project> and looks like a version of <Y>", with three choices:
  - Merge automatically: three-way merge with the stored base;
  - Merge myself: open the two side by side;
  - Not a version: dismiss and remember the decision for that path and hash.
  In a shared project such a file is not added to the share until the user decides. VS Code and the terminal get the prompt; the browser has no sync-tool folder and gets nothing.
- [ ] **D9** `data.json` gains a top-level `deleted: [{id, deletedAt}]`. Merge rules:
  - annotations merge per annotation by `updatedAt`, not by file mtime;
  - a deletion beats a copy of the annotation whose `updatedAt` is older, so an edit made after the deletion wins;
  - a marker older than 90 days is dropped on the next write;
  - `theme` and `reading` still follow the newer file.
- [ ] **D10** The project conflict scan skips shared projects. Their copies are handled by the mirror with the D8 detector, so one folder has one writer.

## 3. Acceptance

- [ ] **A1** Shared project, two members. A member's disk gets an old version of `main.tex`, one the share wrote earlier. The doc keeps the peer's newer text, the file is rewritten, and no delete reaches the peer.
- [ ] **A2** Same as A1 for an image in the project.
- [ ] **A3** A member edits an old version of `main.tex` outside LabShelf while offline. On reconnect only that edit enters the doc, and the peer's newer edits stay. This also holds after an app restart.
- [ ] **A4** One person's two devices share a project and one cloud folder. A mirror write that arrives by cloud before its relay updates is not read into the doc: no text is duplicated and nothing is deleted.
- [ ] **A5** Outside a share, two devices edit the same file and the sync tool overwrites one version silently. The surviving device ends with both edits merged, or a merge question when they overlap.
- [ ] **A6** A conflict copy with an unknown name (`main (1).tex`) is offered as a version of `main.tex`, with the three choices. Every choice does what it says.
- [ ] **A7** In a shared project, that copy is not added to the share before the user decides.
- [ ] **A8** An annotation deleted on one device does not come back through a copy from the other device. An annotation edited after the deletion does come back.
- [ ] **A9** Contracts `collaboration.md`, `library-format.md` and `sync.md` describe D1–D10. Every touched package typechecks and passes its tests.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-share-versions.md](sessions/1-share-versions.md) | `written` list, stored versions, stale and merge rules in the mirror | `packages/core/src/collab/{model,state,mirror}`, its tests, browser `storage/collaboration`, `collaboration.md` | 4 |
| 2 | [sessions/2-write-records.md](sessions/2-write-records.md) | device id, `.labshelf/writes/` records, mirror in-flight wait | core `collab/mirror`, `library/writeRecords`, `library/node/deviceState`, contracts | alone, after 1 |
| 2b | [sessions/2b-divergence.md](sessions/2b-divergence.md) | divergence merge outside a share | core `writing/merge`, VS Code save hook, `sync.md` | alone, after 2 |
| 3 | [sessions/3-copies-by-content.md](sessions/3-copies-by-content.md) | copy detector by content, prompt in VS Code and terminal, held back in shares | core `library/conflicts`, `writing/merge/node`, vscode and terminal conflict UI, `sync.md` | alone, after 2b |
| 4 | [sessions/4-annotation-deletions.md](sessions/4-annotation-deletions.md) | `deleted` markers and per-annotation merge | core `reader/sidecar`, `library/conflicts/sidecarMerge.ts`, `library-format.md` sidecar section | 1 |
