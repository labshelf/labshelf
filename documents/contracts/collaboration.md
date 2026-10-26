# Contract: shared projects

Read when you change how a share is keyed, invited, encrypted or laid out, or what a member's app writes for it.

A share is a writing project that members edit together, each on a full local copy. Members run different apps and versions, and everything between them travels through the share's [relay](relay.md), encrypted end to end with keys derived from one share key. Keys, invites and frames never read what kind of share it is, so another kind would add a sibling of [Project shares](#project-shares).

## Share key

A share key is 16 random bytes. Whoever holds it is an editor. It is a device-local secret (in the app's secret store or the browser extension's storage) and never enters the library or the project. Removing a member means a fresh key, which gives a new share id.

Four values come from it by HKDF-SHA-256 with an empty salt and the label as `info`. Labels and salt are frozen, because every member's app derives the same values.

- `share-id`: public name of the share, written into `labshelf.yaml` as `shared`. It reveals nothing about the key.
- `content`: AES-GCM key for doc updates, snapshots and blobs.
- `awareness`: AES-GCM key for cursors and presence.
- `relay`: the relay token. Every relay of the share takes the same token.

## Invite link

`labshelf://join#v1.<share id>.<share key>.<relay list>`. The key and the relay list are base64url; the relay list is a JSON array of `{url, relayToken?}` with `https:` URLs. The secrets sit in the fragment, so no server sees them. An invite is refused when its share id is not the one its key derives, and when it lists no relay, because a relay is the only way in.

## Frame

Every payload is sealed in a frame. The additional data holds the share id, the doc key and the payload kind, so a frame opens only for the share, doc and kind it was sealed for and cannot be replayed into another doc. A frame that fails to open is dropped. The frame version byte is frozen with the layout.

## Messages

A message is a clear envelope followed by one frame. The envelope version is raised by any change to the envelope or to what a kind carries, and a receiver drops other versions.

- **Doc id**: the first 16 bytes of SHA-256 over `<share id>\0<doc key>` so a relay stores docs without learning file paths. A doc key is a file's POSIX path, or `/index`. The frame is sealed with the doc id in hex as its doc key, and its plaintext starts with the real doc key; a doc key that does not hash to the doc id is dropped.
- **Kinds**: sync steps, `update`, `ack`, `awareness` and `blob`. Kinds 5 to 15 are reserved, 16 to 255 belong to channels, and unknown kinds are dropped. Only `update` is stored by the relay; the rest are forwarded ([relay obligations](relay.md#client-obligations)).
- **Delivery**: sync steps and blobs are reliable, with an epoch (the sender's link to one peer, never lower than its last) and a per-link sequence. A receiver keeps only each peer's current epoch. Delivery is at least once and unordered, which Yjs tolerates.
- **Sync**: on connect each peer sends a state vector for every doc it holds, the index first. A peer ignores messages for docs it does not hold.
- **Blobs**: a blob is requested from one holder at a time and accepted only when its SHA-256 is the requested hash.
- **Awareness** carries each peer's relay state ([Relay list](#relay-list)) and is never stored.

## Project shares

### Docs

One Yjs doc per shared text file, keyed by its POSIX path, with its text in the `Y.Text` `content`, plus the index doc `/index`. The index holds these maps:

- `share`: `kind: "project"`. Any other kind is refused with a typed error, so a later kind never opens as a project.
- `files`: path to `{kind: "text" | "blob", hash?}`. Renames and deletes are edits here.
- `written`: path to the newest agreed disk versions, the mirror's record of what disk and doc last agreed on.
- `settings`, `comments`, `relays`: see below.

A file is text when its extension is a known text extension and its bytes are UTF-8, else a blob. Shared files are what an export would hold, plus `labshelf.bib` and `.labshelf/checklist.json`. `labshelf.yaml` and `comments.json` travel only through `settings` and `comments`.

### Settings

The shared `labshelf.yaml` keys are the ones [library-format.md](library-format.md#labshelfyaml) lists as synced; the others stay per user. Each member writes the shared keys into its own file under the [labshelf.yaml rules](library-format.md#labshelfyaml). Sharing writes `title` when absent, because a joiner names its copy from it.

### Comments

A thread is a `Y.Map` with the keys of a [comments.json](library-format.md#project-folder-labshelf) thread. Its `comments` is a `Y.Array`, so concurrent replies both survive. A live anchor adds `start` and `end` as Yjs relative positions in `content`; `start` binds right and `end` left, so text typed at either edge stays outside. Each mirror writes `.labshelf/comments.json` from the map, and sharing imports the existing file.

### Bibliography

In a share the generator merges into `labshelf.bib` and never removes an entry, because a member without the paper would delete another's reference. It updates an entry with the same key only when it is the same work (same DOI, else same arXiv id, else the shared entry has neither), a rule every member must apply alike, and otherwise keeps it and logs the clash.

### Relay list

The `relays` array holds `{url, addedBy}` entries, in preference order. A member removes only their own. A client uses the index's list, or its invite's while that is empty.

All members must end on the same relay, or they cannot see each other. So each client publishes in awareness which relay it uses and which it holds down, and adopts every peer's marks, with a time cap so a peer cannot mute a relay for long. A relay goes down after a limit refusal from its host or repeated failures. One member keeps awareness-only sockets on the other relays, so a split group finds itself and moves together to the earlier relay. Cursors are per relay: moving to a relay catches up from cursor 0 and puts what that relay lacks.

## Device-local state

Per share, under `collab/<share id>/` in the library's [state folder](library-format.md#device-local-files) and never in the library, where a sync tool would make conflict copies. It holds each doc's snapshot and update log, blobs, the last agreed text of each file, and the relay cursors and held state. The browser keeps the same records in IndexedDB.

- The log is append-only and folded into a snapshot on open. A torn last record is dropped. After a failed append the doc writes nothing until a full snapshot replaces the log.
- An edit is durable once its append (or IndexedDB transaction) completes.
- A relay cursor is saved only after every update received so far is stored.

The mirror between docs and the project folder treats a disk version the share already knows (in the agreed records or in `written`) as the doc's, so the doc wins. Before writing a file it appends to the file's [write record](library-format.md#project-folder-labshelf) with `by: "mirror"`; a disk version recorded that way but not yet in `written` is in flight and waits. Any other disk text is an outside edit and is merged three-way, keeping overlaps in conflict markers. Conflict copies stay out of the share until the user resolves them.

## Mirror ownership

One mirror at a time writes a project folder for a share.

- **Across apps**: a lease file `<project>/.labshelf/mirror-lease.json` with `owner` (random id per mirror), `app` (`vscode` or `browser`), `renewedAt` and `ttlMs`. A lease is live while `renewedAt + ttlMs` is in the future; an invalid file counts as expired. To acquire, write the lease, wait 1.5 s, read it again: only a lease still one's own owns the folder. The owner renews every 10 s against a 30 s TTL; VS Code and the browser must agree on both. Before each renewal and each batch of writes the mirror reads the lease; a foreign owner means it is lost, and the mirror stops writing but keeps the session. An explicit takeover by the user overwrites a live lease. The lease is keyed by folder, so two local copies of one share each run a mirror.
- **Across browser tabs**: a Web Lock per library and share. The holder runs the share; other tabs open it read-only, and an explicit takeover by the user steals the lock.

Two mirrors acquiring within the same 1.5 s can both win; the loser yields at its next read. A lease synced to another device may look expired or live there.

## Membership

- Sharing publishes nothing until the owner has a relay, and a share that fails at any step undoes what it wrote.
- Joining checks the whole invite before writing anything, and stores the key only once connected.
- Leaving closes the connection first and stops, keeping key and state, if an update is not yet stored. Otherwise it forgets the key, removes `shared` and the device-local state, and keeps every project file. Nothing on a relay is deleted.
