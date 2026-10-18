# Contract: shared projects

Read when you change how a share is keyed, invited, encrypted or laid out, or when an app joins one.

A *share* is a unit that LabShelf users edit together, peer to peer, each on a full local copy. Everything that travels between peers or through a relay is encrypted end to end with keys derived from one share key. A writing project is the only kind of share. Keys, the invite and frames never read the kind, so another kind adds a sibling of [Project shares](#project-shares) and changes nothing above it. Core's `collab` module is the one implementation, and every app uses it.

## Share key

- A share key is 16 random bytes. Whoever holds it is an editor, and there are no roles.
- Keys are device-local: VS Code keeps them in `SecretStorage`, and they never enter the library folder or the project.
- Every key is derived with HKDF-SHA-256 from the share key, with an empty salt and the label as `info`:

| Label | Length | Use |
|---|---|---|
| `share-id` | 16 bytes, written as 32 lowercase hex characters | the share id: public, opaque, written into `labshelf.yaml` as `shared` |
| `content` | AES-GCM-256 key | doc updates, snapshots and blobs |
| `awareness` | AES-GCM-256 key | cursors and presence |
| `room` | 32 bytes | the signalling room: bytes 0–15 in hex are the room id, bytes 16–31 in base64url the room password |
| `relay` | 32 bytes, base64url | the relay token a client presents to a relay |

- Removing a member means rotating: the owner makes a fresh share key, which gives a new share id, and invites the remaining members again. Frames sealed under the replaced key stay readable only to whoever kept it.

## Invite link

```
labshelf://join#v1.<share id>.<share key>.<relay list>
```

- The share key is base64url without padding. The relay list is a JSON array of `{url, relayToken?}` objects, UTF-8, base64url without padding, and `[]` when there are none. Every `url` is `https:`.
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

Peers exchange messages over a transport: a WebRTC mesh, signalled through public Nostr relays in a room derived from the `room` key, or a relay. Each message is a clear envelope followed by one [frame](#frame):

```
version (1 byte, 1) | kind (1 byte) | seq (4 bytes, big-endian) | doc id (16 bytes) | frame
```

- The doc id is the first 16 bytes of SHA-256 over the UTF-8 of `<share id>\0<doc key>`, so a relay can store frames per doc without learning paths. A doc key is a file's POSIX path, or `/index` for the index doc, which no relative path can be.
- The frame is sealed with the doc id in hex as its doc key and the kind's name as its payload kind. Its plaintext is the doc key (2-byte big-endian length and UTF-8) followed by the payload. A receiver drops a message whose doc key does not hash to the envelope's doc id.
- `seq` is a per-peer sequence number for reliable kinds and `0` for the rest. The receiver acknowledges reliable messages within about 200 ms. The sender resends a message that has no acknowledgement after 2 s and gives up after 8 attempts, and the next sync on rejoin carries what was lost. Delivery is at least once and unordered, which Yjs updates tolerate.

| Kind | Name | Reliable | Payload |
|---|---|---|---|
| 1 | `syncStep1` | yes | the sender's Yjs state vector of the doc |
| 2 | `syncStep2` | yes | the Yjs update the receiver lacks, answering a step 1 |
| 3 | `update` | yes | a Yjs update made locally |
| 4 | `ack` | no | the acknowledged sequence numbers, 4 bytes each; doc id all zeros |
| 16 | `awareness` | no | a y-protocols awareness update, doc key `/awareness`, sealed with the `awareness` key |
| 17 | `blob` | yes | a [blob](#blobs) message, doc key the blob's SHA-256 hex |

Kinds 5 to 15 are reserved and 16 to 255 belong to channels. A message of an unknown kind is dropped.

### Sync

- When two peers connect, each sends a step 1 for every doc it holds, the index first, so edits made while either was offline arrive.
- A peer holds the index and the docs it has opened; it opens the other text files listed in the index in the background, one at a time. A message for a doc it does not hold is ignored until it opens that doc.
- A mesh holds at most 8 other peers. Further peers wait until a place frees, and the app tells the user that a relay is needed.

### Awareness

Each peer publishes `{name, colour, file, anchor, head}`: its LabShelf user name, a colour from the core palette, the doc key of the file it is in, and its selection as Yjs relative positions in base64, or `null`. A peer sends its whole state to a peer that joins, and drops the states of a peer that leaves. Awareness is never stored.

### Blobs

A blob message starts with a type byte:

| Type | Message | Rest |
|---|---|---|
| 1 | request | nothing |
| 2 | chunk | index and count (4 bytes each, big-endian), then at most 64 KiB of the blob |
| 3 | missing | nothing |

- A peer asks one holder at a time and moves on after a `missing`, a corrupt result, the holder leaving or 15 s of silence.
- The receiver drops a chunk whose count is outside 1 to 4096, whose index is not below the count, or that is longer than 64 KiB. An empty blob is one empty chunk.
- The reassembled bytes are handed out only when their SHA-256 is the requested hash.

## Device-local state

Yjs state and the blob cache live in the library's state dir (see [library-format.md](library-format.md#layout)), under `collab/<share id>/`, never in the library, where the user's sync tool would make conflict copies of them.

## Project shares

### Docs

A project share holds one Yjs doc per shared text file, keyed by its POSIX path relative to the project folder, plus one index doc, keyed `/index`:

| Index map | Holds |
|---|---|
| `share` | `kind: "project"`; a client that reads another kind, or none, refuses the share with a typed error |
| `files` | path → `{kind: "text" \| "blob", hash?}`; `hash` is the SHA-256 hex of a blob; a rename or delete is an edit of this map |
| `settings` | the shared `labshelf.yaml` keys |
| `comments` | comment threads |

### Shared files

- A project shares what an export would hold (no `.git/`, `.labshelf/`, compiler output or PDFs built from a root `.tex` or `.typ`), plus `labshelf.bib`, `.labshelf/checklist.json` and `.labshelf/comments.json`. `labshelf.yaml` is never a text doc.
- A file is text when its extension is a known text extension and its bytes are valid UTF-8, and a blob otherwise.

### Settings

Of `labshelf.yaml`, `format`, `main`, `engine`, `bibliography`, `typst`, `title`, `figures`, `values`, `check`, `target` and `papers` are shared through `settings`. `id`, `folder`, `archived`, `trashed` and `shared` stay per user. Each client writes the shared keys into its own file with the rewrite rules of [library-format.md](library-format.md#labshelfyaml), keeping comments and unknown keys, and removes a shared key the map does not hold.

### Bibliography

In a shared project the generator merges into the shared `labshelf.bib` and never removes an entry, because a member without a paper would otherwise delete another member's reference. It adds the entries the shared file lacks. It updates an entry with the same cite key only when it is the same work: the same DOI, else the same arXiv id, else the shared entry has neither. Otherwise it keeps the shared entry and logs the clash, because two libraries can give one cite key to two papers.
