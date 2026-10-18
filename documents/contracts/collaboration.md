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
version (1 byte, 1) | kind (1 byte) | seq (4 bytes, big-endian) | doc id (16 bytes) | frame
```

- The doc id is the first 16 bytes of SHA-256 over the UTF-8 of `<share id>\0<doc key>`, so a relay can store frames per doc without learning paths. A doc key is a file's POSIX path, or `/index` for the index doc, which no relative path can be.
- The frame is sealed with the doc id in hex as its doc key and the kind's name as its payload kind. Its plaintext is the doc key (2-byte big-endian length and UTF-8) followed by the payload. A receiver drops a message whose doc key does not hash to the envelope's doc id.
- `seq` is a per-peer sequence number for reliable kinds and `0` for the rest. The receiver acknowledges reliable messages within about 200 ms. The sender resends a message that has no acknowledgement after 2 s and gives up after 8 attempts, and the next sync on rejoin carries what was lost. Delivery is at least once and unordered, which Yjs updates tolerate. An `update` has `seq` 0: the relay stores it and pushes it to the connected sockets (see [relay.md](relay.md#clients)), so no peer acknowledges or resends it.

| Kind | Name | Reliable | Payload |
|---|---|---|---|
| 1 | `syncStep1` | yes | the sender's Yjs state vector of the doc |
| 2 | `syncStep2` | yes | the Yjs update the receiver lacks, answering a step 1 |
| 3 | `update` | no | the Yjs updates a client made locally in one batch, merged into one update |
| 4 | `ack` | no | the acknowledged sequence numbers, 4 bytes each; doc id all zeros |
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
  relay-cursors.json           per relay and doc, the last relay row applied; keys are `<relay url> <doc key>`
```

- The log is append-only. Opening the share merges the log into the snapshot and removes it; a torn final record from an interrupted append is dropped.
- A file whose disk hash differs from its `known.json` hash was changed outside the share since disk and doc last agreed, so that change enters the doc. A file with no entry there is compared as new.

## Project shares

### Docs

A project share holds one Yjs doc per shared text file, keyed by its POSIX path relative to the project folder, plus one index doc, keyed `/index`. Each file doc holds its text in the `Y.Text` named `content`.

The index doc holds:

| Index map | Holds |
|---|---|
| `share` | `kind: "project"`; a client that reads another kind, or none, refuses the share with a typed error |
| `files` | path → `{kind: "text" \| "blob", hash?}`; `hash` is the SHA-256 hex of a blob; a rename or delete is an edit of this map |
| `settings` | the shared `labshelf.yaml` keys |
| `comments` | thread id → [comment thread](#comments) |
| `relays` | a `Y.Array`, the [relay list](#relay-list) |

### Relay list

- `relays` holds `{url, addedBy}` entries in the order clients try them: an `https:` relay URL, once, and the LabShelf user name of the member who offered it. The relay token is the share's `relay` key, the same on every relay, so the list does not hold it.
- A member removes only the entries whose `addedBy` is their own user name, from any of their devices.
- A client tries the list of its index doc, or the relays of its invite while that list is empty, so a member who joined can reach a relay before the index arrives.
- A client uses the first relay in list order that is not down and that answers `GET /version` with a compatible major within 3 s.
- While connected, a client probes the relay it uses and every relay listed before it with `GET /version` every 60 s, and retries a failed probe after 20 s. One failed probe does not move it.
- A client marks a relay down for one hour when the relay refuses for limits (HTTP 429, or Cloudflare's error 1027) or after three failures in a row: a probe or ticket request that gets no answer or a refusal, or a socket that closes before it opens. An open socket resets the count. A down mark moves the client as a closed socket does.
- A probe that a relay answers ends a down mark this client's own probes set; it does not end a mark from its connection or adopted from a peer. So a newcomer that could not reach a relay rejoins it at its next answered probe, and a group that moved together stays together until the hour ends. The client with the lowest awareness id on the relay in use is the watcher. After its socket opens it keeps an awareness-only socket to every other listed relay it does not hold down, publishes the group's relay there and adopts the down marks published there, so the group moves together within seconds. A watcher acks the reliable messages it does not read and is never a doc or blob peer. Failures of a watch socket count toward the three in a row. A client that sees its group on a relay listed before its own, which it does not hold down, retries that relay at once; only the hold rules above hold it down.
- Each client publishes in its [awareness](#awareness) `relay`, the URL in use or `null`, and `relaysDown`, URL to the epoch milliseconds its hold ends. A client adopts every mark a peer publishes, capped at one hour from its own clock, so the group moves together off a relay one member found down and back to it when the hold ends.
- A client that moves to another relay closes its socket to the previous one, then catches up on the new one from cursor 0 and puts what that relay lacks, so a member who later reaches only the new relay catches up there (see [relay.md](relay.md#clients)). Relay cursors are kept per relay URL.

### Shared files

- A project shares what an export would hold (no `.git/`, `.labshelf/`, compiler output or PDFs built from a root `.tex` or `.typ`), plus `labshelf.bib` and `.labshelf/checklist.json`. `labshelf.yaml` is never a text doc, and neither is `.labshelf/comments.json`, whose threads travel in [`comments`](#comments).
- A file is text when its extension is a known text extension and its bytes are valid UTF-8, and a blob otherwise.

### Comments

- Each thread in `comments` is a `Y.Map` with the keys of a thread in [comments.json](library-format.md#labshelfcommentsjson): `id`, `file`, `anchor` and `resolved` as plain JSON values, and `comments` as a `Y.Array` of plain comment objects. A reply is a push onto that array, so replies two members add at once both survive. Keys a client does not know are kept.
- A live anchor adds `start` and `end` to `{quote, prefix, suffix}`: Yjs relative positions in the file doc's `content`, in base64. `start` binds to the character after it and `end` to the character before it, so text typed at either edge stays outside the thread.
- A client places a thread in this order: the range between `start` and `end` when both resolve to a non-empty range in the file's `content`; else an exact occurrence of `quote`, the one whose surrounding text best matches `prefix` and `suffix`; else the closest approximate match of `quote` above a similarity threshold. A thread placed nowhere is detached: it stays listed, without a place in the text.
- Each client writes its project's `.labshelf/comments.json` from the map, so every member's file holds the same threads in the same order. Top-level keys and entries that are not valid threads stay in the file they were in and do not travel. Sharing a project imports the threads of its `comments.json` into the map.

### Settings

Of `labshelf.yaml`, `format`, `main`, `engine`, `bibliography`, `typst`, `title`, `figures`, `values`, `check`, `target` and `papers` are shared through `settings`. `id`, `folder`, `archived`, `trashed` and `shared` stay per user. Each client writes the shared keys into its own file with the rewrite rules of [library-format.md](library-format.md#labshelfyaml), keeping comments and unknown keys, and removes a shared key the map does not hold.

### Bibliography

In a shared project the generator merges into the shared `labshelf.bib` and never removes an entry, because a member without a paper would otherwise delete another member's reference. It adds the entries the shared file lacks. It updates an entry with the same cite key only when it is the same work: the same DOI, else the same arXiv id, else the shared entry has neither. Otherwise it keeps the shared entry and logs the clash, because two libraries can give one cite key to two papers.
