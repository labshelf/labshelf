# Contract: shared projects

Read when you change how a share is keyed, invited, encrypted or laid out, or when an app joins one.

A *share* is a unit that LabShelf users edit together, each on a full local copy. Everything that travels between members, through the share's [relay](relay.md), is encrypted end to end with keys derived from one share key. A writing project is the only kind of share. Keys, the invite and frames never read the kind, so another kind adds a sibling of [Project shares](#project-shares) and changes nothing above it. Core's `collab` module is the one implementation, and every app uses it.

## Share key

- A share key is 16 random bytes. Whoever holds it is an editor, and there are no roles.
- Keys are device-local: VS Code keeps them in `SecretStorage`, and they never enter the library folder or the project.
- Every key is derived with HKDF-SHA-256 from the share key, with an empty salt and the label as `info`:

| Label | Length | Use |
|---|---|---|
| `share-id` | 16 bytes, written as 32 lowercase hex characters | the share id: public, opaque, written into `labshelf.yaml` as `shared` |
| `content` | AES-GCM-256 key | doc updates, snapshots and blobs |
| `awareness` | AES-GCM-256 key | cursors and presence |
| `relay` | 32 bytes, base64url | the relay token a client presents to a relay |

- Removing a member means rotating: the owner makes a fresh share key, which gives a new share id, and invites the remaining members again. Frames sealed under the replaced key stay readable only to whoever kept it.

## Invite link

```
labshelf://join#v1.<share id>.<share key>.<relay list>
```

- The share key is base64url without padding. The relay list is a JSON array of `{url, relayToken?}` objects, UTF-8, base64url without padding, and `[]` when there are none. Every `url` is `https:`. A joiner reaches the share only through a relay, so an app refuses to join with an invite whose list is empty.
- The secrets sit in the fragment, so a server that sees the URL never sees them.
- An app finds the link anywhere in pasted text. It rejects the link, naming the reason, when the version is unknown, a part is malformed, a relay entry has another field or a non-`https:` URL, or the share id is not the one the key derives.

## Frame

Every payload travels as one frame:

```
version (1 byte, 1) | nonce (12 random bytes) | AES-GCM ciphertext and 16-byte tag
```

- The additional data is the version byte followed by the share id, the doc key and the payload kind, each as a 4-byte big-endian length and its UTF-8 bytes. A frame therefore opens only for the share, doc and kind it was sealed for.
- A frame that fails to open is dropped and never applied.

## Messages

Members exchange messages through the share's relay, which is the only transport; [relay.md](relay.md#socket-messages) defines how it carries and stores them. Each message is a clear envelope followed by one [frame](#frame):

```
version (1 byte, 3) | kind (1 byte) | epoch (8 bytes, big-endian) | seq (4 bytes, big-endian) | doc id (16 bytes) | frame
```

- The doc id is the first 16 bytes of SHA-256 over the UTF-8 of `<share id>\0<doc key>`, so a relay can store frames per doc without learning paths. A doc key is a file's POSIX path, or `/index` for the index doc, which no relative path can be.
- The frame is sealed with the doc id in hex as its doc key and the kind's name as its payload kind. Its plaintext is the doc key (2-byte big-endian length and UTF-8) followed by the payload. A receiver drops a message whose doc key does not hash to the envelope's doc id.
- `epoch` names the sender's link to the receiver. The sender picks one each time it opens a link to a peer: the high 48 bits are the open time in Unix milliseconds and the low 16 bits are random. When its clock has gone backwards it uses its previous epoch plus 1, so a sender's epochs only increase and a link one side reopens is never mistaken for the old one. Messages that are not reliable carry epoch `0`.
- `seq` is a per-link sequence number for reliable kinds, starting at 1 in each epoch, and `0` for the rest. A receiver tracks only the current epoch of each peer. A reliable message of a higher epoch makes it forget the sequence numbers of the current one and adopt the higher one; a reliable message of a lower epoch, or of epoch `0`, is dropped and not acknowledged. The first message a receiver sees in an epoch may have a `seq` above 1, because the receiver may have reopened its own link while the sender kept its own. When more than 1,024 sequence numbers arrived past a gap, the oldest gap has used up its resends and the receiver counts it as delivered. The receiver acknowledges reliable messages within about 200 ms. The sender resends a message that has no acknowledgement after 2 s and gives up after 8 attempts, and the next sync on rejoin carries what was lost. Delivery is at least once and unordered, which Yjs updates tolerate. An `update` has `seq` 0: the relay stores it and pushes it to the connected sockets (see [relay.md](relay.md#clients)), so no peer acknowledges or resends it.

| Kind | Name | Reliable | Payload |
|---|---|---|---|
| 1 | `syncStep1` | yes | the sender's Yjs state vector of the doc |
| 2 | `syncStep2` | yes | the Yjs update the receiver lacks, answering a step 1 |
| 3 | `update` | no | the Yjs updates a client made locally in one batch, merged into one update |
| 4 | `ack` | no | the epoch of the acknowledged messages (8 bytes), then their sequence numbers, 4 bytes each; doc id all zeros. A sender applies an ack only when its epoch is the one of its current link to that peer |
| 16 | `awareness` | no | a y-protocols awareness update, doc key `/awareness`, sealed with the `awareness` key; the relay forwards it and never stores it |
| 17 | `blob` | yes | a [blob](#blobs) message, doc key the blob's SHA-256 hex |

Kinds 5 to 15 are reserved and 16 to 255 belong to channels. A message of an unknown kind is dropped.

### Sync

- When two peers connect, each sends a step 1 for every doc it holds, the index first, so edits made while either was offline arrive. A peer is another socket of the same share on the relay.
- A client also catches up from the relay's stored rows and puts what it holds beyond them ([relay.md](relay.md#clients)); the relay's rows are the catch-up for members who are not connected at the same time.
- A peer holds the index and the docs it has opened; it opens the other text files listed in the index in the background, one at a time. A message for a doc it does not hold is ignored until it opens that doc.
- A session is `open` until the app closes it, then `closed`.

### Awareness

Each peer publishes `{name, colour, file, anchor, head}`: its LabShelf user name, a colour from the core palette, the doc key of the file it is in, and its selection as Yjs relative positions in base64, or `null`. A peer adds `relay` and `relaysDown` of the [relay list](#relay-list). A peer sends its whole state to a peer that joins, and drops the states of a peer that leaves. Awareness is never stored, and the transport sends a client's awareness at most once every 250 ms, keeping only the latest.

### Blobs

A blob message starts with a type byte:

| Type | Message | Rest |
|---|---|---|
| 1 | request | nothing |
| 2 | chunk | index and count (4 bytes each, big-endian), then at most 64 KiB of the blob |
| 3 | missing | nothing |

- A peer asks one holder at a time and moves on after a `missing`, a corrupt result, the holder leaving or 15 s of silence.
- The receiver drops a chunk whose count is outside 1 to 4096, whose index is not below the count, or that is longer than 64 KiB. An empty blob is one empty chunk. A blob is at most 4096 chunks (256 MiB), and a peer answers `missing` for a larger one.
- The reassembled bytes are handed out only when their SHA-256 is the requested hash.

## Device-local state

Yjs state and the blob cache live in the library's state dir (see [library-format.md](library-format.md#device-local-files)), under `collab/<share id>/`, never in the library, where the user's sync tool would make conflict copies of them:

```
collab/<share id>/
  docs/<doc id hex>.snapshot   a doc's Yjs state as one update; the doc id is the one of the envelope, so no path appears
  docs/<doc id hex>.log        the updates made since the snapshot, each a 4-byte big-endian length and the update
  blobs/<sha256>               a blob of the share, served to peers that ask for it
  known.json                   per shared path, the SHA-256 of the content disk and doc last agreed on
  versions.json                per shared path, the newest 50 agreed text versions as [{hash, text}]
  bases.json                   per shared text path, the last text disk and doc agreed on
  relay-cursors.json           per relay and doc, the last relay row applied; keys are `<relay url> <doc key>`
  relay-held.json              per relay and doc, the Yjs state the relay holds as a base64 Yjs snapshot (see relay.md#clients); keys as in relay-cursors.json
```

- The log is append-only. Opening the share merges the log into the snapshot and removes it; a torn final record from an interrupted append is dropped.
- After a failed append, a doc appends nothing more until its full state is written as the snapshot and its log removed, so a torn record is always the last one.
- `relay-cursors.json` is saved only once every doc update received so far is stored; while one is not, the cursors are held back. `relay-held.json` describes the relay, not the docs, so it is saved without that wait.
- Each mirror records every text or blob it writes or agrees with on disk in the index's [`written`](#docs) map. For text it also remembers the version in `versions.json` and updates `bases.json`; both survive restarting the app.
- When disk and doc differ, a disk hash matching `known.json` means the doc moved on: the mirror writes the doc to disk. A changing file waits until it settles, and an empty doc waiting for sync keeps its disk copy until its peers supply its state.
- A settled disk hash in `written` is a recognized version of the share. The mirror writes the current shared text or blob over it and leaves the doc or blob index entry unchanged.
- Before writing disk bytes, the mirror appends their hash and the previously known hash as parent to its [per-device write record](library-format.md#labshelfwrites). It checks folder ownership and readability before this append. A record marked `mirror` whose hash is absent from `written` is in flight: its disk copy stays outside the share, including when its file entry has not arrived. The wait has no time limit; a newer disk change replaces it, and doc updates, written-history updates and record-file changes retry it.
- An unrecognized disk hash while the relay is connected waits for a fresh index `since` request to finish, including every page of its answer, before entering the share. A canceled or refused round trip leaves the edit waiting for another connection or file change. No timer releases this wait.
- Source editors bind only files listed as text in the share index. A browser file without that entry stays read-only; Retry opens it for shared edits once the entry arrives.
- Any other disk text is an outside edit. Its app write record supplies the parent hash when that text version is stored locally. Otherwise it merges into the current doc against the stored version with the most equal lines, counting repeated lines only as often as both texts contain them, divided by the larger line count. Line endings and a final newline do not affect similarity. The persisted base wins a tie; otherwise the most recent stored version wins. Non-overlapping edits survive on both sides; overlapping edits keep both sides in conflict markers. With no stored version, the disk text enters the doc with a warning. An unrecognized blob replaces the indexed blob without a text merge.

The browser extension keeps the same state in its IndexedDB database `labshelf-collab`, outside the library files, with share keys starting with the library id and share id. The per-library device identity uses a separate namespace so leaving a share preserves it. It stores each doc under its doc key, with a snapshot and its appended updates; the known hashes, stored text versions, bases, relay cursors and relay held states as one map record each; and blobs by SHA-256. A write is durable when its transaction completes. Replacing a snapshot and removing that doc's updates is one transaction, so no torn record exists, and the rules above hold unchanged.

## Connection lifecycle

A device connects to a share in this order, the same in every app: open the device-local state, start the session over it, publish this user's presence, follow the relays, start the blob exchange, find or create the project folder, start the disk mirror.

- Presence is published as soon as the session starts, with no file. Only members with a presence count in the relay group and in the snapshot-writer election: the connected member with the lowest awareness id on the relay in use writes relay snapshots, and when it leaves the next lowest takes over.
- Closing runs presence, blob exchange, mirror, relays, session, state, in that order, and completes every step even after one fails. It resolves once every update received or made is stored, and rejects while any stays unstored.
- A start that fails closes what it started in the same order, so no socket, probe, timer or state handle outlives it; the start's error is the one reported.
- Reconnecting restores the docs and the per-relay cursors from the device-local state. Peers and relays supply only what this device lacks.
- A connection reports its session status, the relay in use, the error of a state write that has not succeeded since it failed, and its mirror: running, busy while another mirror owns the folder, or stopped with a reason. Logs name the share id, never an invite or a key.

### Sharing, joining and leaving

Every app runs these steps through the same core workflows; the app supplies only the user's choices and its key store, connection registry, project list and state dir.

- **Share.** Nothing is published before the owner has a relay: with none connected, the app offers to connect one, and a cancel shares nothing. The device then makes a share key, stores it, and connects with `share`, which writes `shared: <share id>` into labshelf.yaml, plus `title: <id>` when the project has no title, because only the title is shared and a joiner names its copy from it. Once connected it offers the owner's relay to the [relay list](#relay-list) and hands out the invite. A share that fails or is cancelled at any step closes its connection, forgets the key, puts labshelf.yaml back as it was, removes the device-local state it wrote, and reports the error. Sharing a project that is shared already reconnects it from the stored key; without one, the app asks for the invite.
- **Invite to hand out.** The invite is formatted from the stored key and the relays the index lists at that moment, or the stored invite's relays while that list is empty, and is stored again in that form.
- **Join.** The pasted invite is checked in full (it parses, its share id derives from its key, it lists a relay) before anything is written, so a refused invite creates nothing. A share connected already is left as it is. A project whose `shared` names the share reconnects with `resume`; otherwise a new project is created under `projects/` once the index arrives, and a share that is not a project is refused. The key is stored after the connection stands, so a failed join leaves no key.
- **Resume.** On every reload of the project list a device closes the connections whose project left the list or lost its `shared` field, and reconnects each shared project that is not in the trash from its stored key. A shared project without a stored key, and a reconnect that fails, are each reported once per share.
- **Leave.** Leaving closes the connection first. When the close leaves an update unstored, the leave stops and reports it: the key, the `shared` field and the state stay, so a retry loses nothing. Otherwise the device forgets the key, removes `shared` from labshelf.yaml and deletes the share's [device-local state](#device-local-state). Every project file stays, the other members keep the share, and nothing on a relay is deleted. Pasting the invite again joins it as a new project.

### Persistence acknowledgment

An edit is durable on this device once the write of its update completes: an append to the doc's log on Node, a completed IndexedDB transaction in the browser. Each update is written as it happens, not when the page or window closes; a browser page that dies loses only updates whose transaction had not completed, and those reached the relay if the socket was open. The browser's close on `pagehide` is best effort and nothing depends on it. When an update cannot be written, the app shows one error notice per failure episode (it appears again only after the writes recovered and failed again), and the share's details and the VS Code status bar show the problem while it lasts.

In the browser the tab that holds the share's Web Lock (see [Mirror ownership](#mirror-ownership)) is the only one that opens the share's state, session and mirror. A tab that finds the lock held waits for it; when the owner closes, dies or hands over, the waiting tab takes the lock and reconnects from the stored state. Closing every library page ends the share's connectivity on that device and drops no acknowledged edit.

## Mirror ownership

One mirror at a time writes a project folder's files for a share.

In the browser, an exclusive Web Lock named `labshelf:collab:<library id>:<share id>` decides which tab of the profile runs the share's session and mirror. A tab that finds it held opens the share read-only with a "Use here" action, which steals the lock. The tab that loses it stops its mirror, keeps its editor buffers and pending text, and never writes to disk again in that session. A library kept in IndexedDB has no folder, so only the lock applies.

Across apps, the folder holds a lease at `<project>/.labshelf/mirror-lease.json`, written through the root's own file port:

```json
{ "owner": "<random id per running mirror>", "app": "vscode", "renewedAt": 1792509862000, "ttlMs": 30000 }
```

- `app` is `vscode` or `browser`; `renewedAt` is in ms since the epoch. A lease is live while `renewedAt + ttlMs` is in the future.
- Acquire: a live foreign lease means the folder is busy. Otherwise the mirror writes its lease, waits 1.5 s and reads it again; only a lease that is still its own makes it the owner.
- A file that is not a valid lease counts as expired and is replaced, with a warning in the log.
- The owner renews every 10 s. Before each renewal and each batch of disk writes it reads the lease; a foreign owner there means the lease is lost: the mirror stops writing to disk, keeps the session connected and the editor buffers, and reports the loss.
- "Use here" writes the lease over a live foreign one; the old owner sees it at its next check.
- A VS Code window whose folder is busy runs the share without a mirror, shows the folder as busy in the share status bar item, and retries the lease every 5 s until it owns the folder or the share closes.
- A mirror that dies leaves its lease to expire after 30 s. A clean close deletes the file only while it is still its own.
- The lease is keyed by the folder, not the share, so two local copies of one share each run a mirror.

Limits: reading then writing is not atomic on any file port. Two mirrors that write inside the same 1.5 s window can both acquire; the loser yields at its first check. A folder synced to another device carries the lease too, and sync delay can make it look expired there or live after its owner stopped.

## Project shares

### Docs

A project share holds one Yjs doc per shared text file, keyed by its POSIX path relative to the project folder, plus one index doc, keyed `/index`. Each file doc holds its text in the `Y.Text` named `content`.

The index doc holds:

| Index map | Holds |
|---|---|
| `share` | `kind: "project"`; a client that reads another kind, or none, refuses the share with a typed error |
| `files` | path → `{kind: "text" \| "blob", hash?}`; `hash` is the SHA-256 hex of a blob; a rename or delete is an edit of this map |
| `written` | path → `Y.Array<{hash: string, at: number}>`, the newest 200 agreed disk versions, with `at` in milliseconds since the epoch; a consecutive duplicate hash is omitted |
| `settings` | the shared `labshelf.yaml` keys |
| `comments` | thread id → [comment thread](#comments) |
| `relays` | a `Y.Array`, the [relay list](#relay-list) |

Removing a path from `files` removes its `written` history. Concurrent appends preserve each mirror’s written versions.

A History restore writes the restored text into each shared file's doc so peers receive it, and a file the restore removes leaves the `files` map.

### Relay list

- `relays` holds `{url, addedBy}` entries in the order clients try them: an `https:` relay URL, once, and the LabShelf user name of the member who offered it. The relay token is the share's `relay` key, the same on every relay, so the list does not hold it.
- A member removes only the entries whose `addedBy` is their own user name, from any of their devices.
- A client tries the list of its index doc, or the relays of its invite while that list is empty, so a member who joined can reach a relay before the index arrives.
- A client uses the first relay in list order that is not down and that answers `GET /version` with a compatible major within 3 s.
- While connected, a client probes the relay it uses and every relay listed before it with `GET /version` every 60 s, and retries a failed probe after 20 s. One failed probe does not move it.
- A client marks a relay down for one hour when the relay refuses for limits (HTTP 429, or Cloudflare's error 1027) or after three failures in a row: a probe or ticket request that gets no answer or a refusal, or a socket that closes before it opens. An open socket resets the count and ends the relay's down mark, since it needs a ticket the relay granted. A down mark moves the client as a closed socket does, and counts only while another listed relay is not down: while every listed relay is down, including the only one, the client keeps the relay it uses and requests tickets with the [reconnect backoff](relay.md#client-obligations) capped at 60 s, probes every listed relay, and ends the mark of a relay that answers a probe.
- A probe that a relay answers ends a down mark this client's own probes set; while another listed relay is not down, it does not end a mark from its connection or adopted from a peer. So a newcomer that could not reach a relay rejoins it at its next answered probe, and a group that moved together stays together until the hour ends. The client with the lowest awareness id on the relay in use is the watcher. After its socket opens it keeps an awareness-only socket to every other listed relay it does not hold down, publishes the group's relay there and adopts the down marks published there, so the group moves together within seconds. A watcher acks the reliable messages it does not read and is never a doc or blob peer. Failures of a watch socket count toward the three in a row. A client that sees its group on a relay listed before its own, which it does not hold down, retries that relay at once; only the hold rules above hold it down.
- Each client publishes in its [awareness](#awareness) `relay`, the URL in use or `null`, and `relaysDown`, URL to the epoch milliseconds its hold ends. A client adopts every mark a peer publishes, capped at one hour from its own clock, so the group moves together off a relay one member found down and back to it when the hold ends.
- A client that moves to another relay closes its socket to the previous one, then catches up on the new one from cursor 0 and puts what that relay lacks, so a member who later reaches only the new relay catches up there (see [relay.md](relay.md#clients)). Relay cursors are kept per relay URL.

### Shared files

- A project shares what an export would hold (no `.git/`, `.labshelf/`, compiler output or PDFs built from a root `.tex` or `.typ`), plus `labshelf.bib` and `.labshelf/checklist.json`. `labshelf.yaml` is never a text doc, and neither is `.labshelf/comments.json`, whose threads travel in [`comments`](#comments).
- A file is text when its extension is a known text extension and its bytes are valid UTF-8, and a blob otherwise.

### Comments

- Each thread in `comments` is a `Y.Map` with the keys of a thread in [comments.json](library-format.md#labshelfcommentsjson): `id`, `file`, `anchor` and `resolved` as plain JSON values, and `comments` as a `Y.Array` of plain comment objects. A reply is a push onto that array, so replies two members add at once both survive. Keys a client does not know are kept.
- A live anchor adds `start` and `end` to `{quote, prefix, suffix}`: Yjs relative positions in the file doc's `content`, in base64. `start` binds to the character after it and `end` to the character before it, so text typed at either edge stays outside the thread.
- A client places a thread in this order: the range between `start` and `end` when both resolve to a non-empty range in the file's `content`; else an exact occurrence of `quote`, the one whose surrounding text best matches `prefix` and `suffix`; else the closest approximate match of `quote` above a similarity threshold. A thread placed nowhere is detached: it stays listed, without a place in the text.
- Each client's disk mirror writes its project's `.labshelf/comments.json` from the map, behind the same ownership checks as every other file, so every member's file holds the same threads in the same order. Top-level keys and entries that are not valid threads stay in the file they were in and do not travel. Sharing a project imports the threads of its `comments.json` into the map.

### Settings

Of `labshelf.yaml`, `format`, `main`, `engine`, `bibliography`, `typst`, `title`, `figures`, `values`, `check`, `target` and `papers` are shared through `settings`. `id`, `folder`, `archived`, `trashed` and `shared` stay per user. Each client writes the shared keys into its own file with the rewrite rules of [library-format.md](library-format.md#labshelfyaml), keeping comments and unknown keys, and removes a shared key the map does not hold.

### Bibliography

In a shared project the generator merges into the shared `labshelf.bib` and never removes an entry, because a member without a paper would otherwise delete another member's reference. It adds the entries the shared file lacks. It updates an entry with the same cite key only when it is the same work: the same DOI, else the same arXiv id, else the shared entry has neither. Otherwise it keeps the shared entry and logs the clash, because two libraries can give one cite key to two papers.
