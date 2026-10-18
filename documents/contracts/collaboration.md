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

## Device-local state

Yjs state and the blob cache live in the library's state dir (see [library-format.md](library-format.md#layout)), under `collab/<share id>/`, never in the library, where the user's sync tool would make conflict copies of them.

## Project shares

### Docs

A project share holds one Yjs doc per shared text file, keyed by its POSIX path relative to the project folder, plus one `index` doc:

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
