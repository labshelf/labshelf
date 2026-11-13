# Contract: local sync

Read when you change how one user's open files stay in step across the views of one app, the pages of one browser, or two apps that meet at the same folder.

Local sync is between one user's own views of their own files; it has no share key, relay, awareness or persisted Yjs state, and sharing between users stays with the [shared projects](collaboration.md) contract. Plan `local-sync` holds the decisions (D1 to D9) this contract states as rules.

## Model

Inside one app there is one live copy per open file, and every view of the file is a participant of that copy. In VS Code it is the window's `vscode.TextDocument`. In the browser it is a Y.Doc held in memory per open file, shared by every view of the page and by every extension page (source tab, reader page, notes tab, popups) through the [channel](#channel-and-messages). Between apps (VS Code and the browser, or two VS Code windows) the file on disk is the meeting point: every write is checked against the text the writer last read, and a mismatch is [merged](#merge) three-way before the write. /open meets the home folder through the Mirror (base hash) plus a merge on the page side ([Hosts](#hosts)). The disk file is always the truth; Yjs docs are never stored.

## Channel and messages

- **Name**: `labshelf:files:<libraryId>` (`replicaChannelName`). Every page of the library listens on it; the browser adapter is a BroadcastChannel, core only sees the `ReplicaChannel` port.
- **Envelope**: `{key, from, to?, bytes}`. `key` is the file's path in the library, opaque to the hub. `from` is the sending page's id (a random UUID by default). `to`, when set, addresses one page; without it every page reads the message.
- **Bytes**: one y-protocols sync message: a var-uint tag, then a var-length byte array. Tag 0 is step1 (a state vector), 1 is step2 (the update the sender's state vector lacks), 2 is an update. Other tags and malformed bytes are dropped.
- **Addressing**: a page drops a message whose `from` is its own id, whose `to` is set and is not its id, or whose key it does not hold.
- **Who answers**: only a replica whose `ready` has resolved answers a step1, with a step2 addressed to the sender and, the first time for that sender, its own step1 to it. A replica still waiting for a peer answers nothing. Step2s and updates for a held key are applied whether or not it is ready.
- **Updates**: every change of a held doc whose origin is not a peer message is posted to all as an update; updates from peers are not posted again (every page is on the channel).

## Replicas

- **Kinds**: `deriveReplicaKind(path)` is `qmd` for an item file (`.qmd`) and `text` for every other file. A text replica's doc holds the file in the Y.Text `content`, the layout the source editor binds; a qmd replica holds the [sharedQmdDoc](qmd-items.md) layout, so qmd editors bind item by item. Opening a held key with another kind throws.
- **Text and replace**: `text()` reads the doc through its layout. `replace(text, origin)` turns the doc into `text` with a minimal diff in one transaction (text: one delete and one insert between the common prefix and suffix, never splitting a surrogate pair; qmd: item by item), and does nothing when the text is equal, so cursors and selections outside the change stay where they were.
- **Refcount**: `open(key)` again in the same page returns the same replica and counts up; `release()` counts down. At zero the doc's listeners are removed, the doc is destroyed and the page stops holding the key, so messages for it are dropped; extra releases do nothing and the next open creates a new replica. `close()` releases every replica and stops listening, posting nothing.
- **Seeding**: the first open in a page posts a step1 to all and waits `peerWaitMs` (200 ms by default). A step2 that arrives first is applied and `ready` resolves `peer`. Otherwise the disk text is read and `ready` resolves `disk`; a failed read rejects `ready` and leaves the doc empty. The seed is built in a fresh doc whose client id is the FNV-1a hash of the disk text (32 bits, never 0) and applied to the replica as an update, so two pages that seed the same text hold identical structs and later sync to one copy of it.
- **Known limit**: two pages that open the same file within one peer wait and read different disk texts end with both texts in the doc.

## Merge

`mergeLocalFile({path, base, local, other}, textMerge)` takes another app's text into a file:

- `local` equal to `other`, or `other` equal to `base`: the result is `local`. `local` equal to `base`: the result is `other`.
- Otherwise a qmd item file merges item by item (`mergeItemFiles`) and every other text line by line (`createTextMerge`, diff3).
- A clean merge is applied silently.
- An overlapping conflict is never written: the file keeps `local`, and `other` is written to `conflictCopyPath(path)`, `<path>.labshelf-conflict-<uuid v4>`, with a notice naming the copy (the same rule as the /open host pull).
- Applying the result into a live doc is a `replace`, a minimal diff.

## Disk writer

In the browser exactly one page writes a file: the holder of the Web Lock `labshelf:file:<libraryId>:<path>`. Other pages with the file open queue a request for the lock and take over when the holder closes the file or the page.

- **Base**: the writer keeps the text it last read from or wrote to disk.
- **Persist**: 300 ms after the last change of the doc, the writer reads the disk. Disk equal to base: write the doc's text. Otherwise [merge](#merge) (base, doc, disk), write the result and apply (doc to result) into the doc as one transaction with origin `disk`.
- **Watch**: a FileSystemObserver where one exists; otherwise a stat (lastModified, size) of the files it writes every 2 s while the page is visible and at once on visibility change or focus. Bridge `changed` events also trigger it. A change the watch sees is merged into the doc the same way.
- **Flush**: `DiskWriters.flush(path)` runs the pending persist of `path` at once when this page holds its writer, and resolves without a write otherwise.

## Hosts

**Browser writers that are not editors** (paper and project notes stores, cite popups, search and replace, history restore, the deck saver, citation re-anchoring) keep writing through `LibraryFileSystem`; the page's file system turns a text write to a file with a live replica in any page into `replica.replace(text)` instead of a disk write (plan D5). A page decides a file is live by holding its replica or by finding its writer lock held or pending in `navigator.locks.query()`; a programmatic write to a live file goes into the replica without its own writer, and the writer attaches only after the replica is seeded.

**Browser note tabs and the reader.** A project note tab and a paper's notes tab bind live to the file's qmd replica, one editor per item on the item's fragment, so every tab of the file edits one doc; without live files they read the file once. The reader page holds its paper's `notes.qmd` live while it is open and pushes the notes again to its floating notes and notes tab when the replica changes.

**VS Code** writes a file through its open TextDocument (WorkspaceEdit and save) and through atomic fs only when none is open; the notes and deck editors save 300 ms after their last edit; a dirty LabShelf document whose file changes on disk is merged with base = the text at its last save, a conflict keeping the document side and writing the disk side to a conflict copy (plan D6).

**VS Code LabShelf writers.** Every LabShelf text write (the library file system's `writeText` and the paper notes port, so reader notes too) goes through the window's open TextDocument of the file, as one minimal edit and a save, and its reads see that document's text, unsaved edits included; a file with no open document is written atomically on disk (plan D6a).

**VS Code dirty-document merge.** The source, notes and deck editors track their documents while a panel is open. When the file changes on disk while the document is dirty, the disk text is merged three-way with base = the document's text at its last save: the document is reverted to the disk text (so VS Code shows no "file is newer" dialog), the merged text is applied as one edit and saved. A conflict keeps the document side, writes the disk side to a conflict copy and shows a warning naming it. A clean document is left to VS Code to reload (plan D6c).

**VS Code autosave and reader.** The notes and deck editors save their document 300 ms after the last page edit; the source editor saves only on an explicit save, and a dirty `.tex` is covered by the merge above (plan D6b). The reader panel follows the paper's `notes.qmd` as a document and as a file, and re-pushes its notes when either changes, whichever editor made the edit (plan D6d).

**Reader consult.** The reader offers Consult when its host does. VS Code: the reader webview posts `{command: 'consult', message: ConsultOutbound}` and receives the `ConsultInbound` messages as host messages; the host answers through `ReaderHostPorts.consult`, and `init.hasConsult` is true only when that port exists, so the webview shows Consult only then. A consult message with no port is dropped. The reader has no project, so its consult lists paper notes and every project's manuscripts and notes, and its windows are further clients of the same `SourceAuthority` per file. Browser: the reader runs in the hub's page and consults the page's live files directly, with no message.

**/open** merges on the page side: a 409 from the mirror edit fetches the current row and merges it with the refused edit (base = the text the page last read or saved; qmd item by item, other text line by line); a clean merge is sent again with the 409's row hash as base, at most three sends in all, and an overlapping change still shows the conflict notice. A write waiting behind a merged send is rebased onto the merged text. The page re-checks the row hash of its open files on focus, visibility and every 30 s and takes in a newer row of a file with no write waiting (plan D7).
