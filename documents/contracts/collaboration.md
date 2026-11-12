# Contract: shared projects

Read when you change how a share is keyed, invited, encrypted or laid out, or what a member's app writes for it.

A share is a writing project or a Space that members edit together, each on a full local copy. Members run different apps and versions, and everything between them travels through the share's [relay](relay.md), encrypted end to end with keys derived from one share key. Keys, invites and frames never read what kind of share it is; the index names it, and [Project shares](#project-shares) and [Space shares](#space-shares) say what each kind holds.

## Share key

A share key is 16 random bytes. Whoever holds it is an editor. It is a device-local secret (in the app's secret store or the browser extension's storage) and never enters the library or the project. Removing a member means a fresh key, which gives a new share id.

Four values come from it by HKDF-SHA-256 with an empty salt and the label as `info`. Labels and salt are frozen, because every member's app derives the same values.

- `share-id`: public name of the share, written into `labshelf.yaml` as `shared`. It reveals nothing about the key.
- `content`: AES-GCM key for doc updates, snapshots and blobs.
- `awareness`: AES-GCM key for cursors and presence.
- `relay`: the relay token. Every relay of the share takes the same token.

## Invite link

`labshelf://join#v1.<share key>.<relay>~<relay>…`. The key is base64url; each relay is a [relay host](share-link.md#relay-host); with no relay the link ends after the key. The share id and the relay token are derived from the key, so the link carries neither. The secrets sit in the fragment, so no server sees them. An invite is refused when it lists no relay, because a relay is the only way in.

## Identity

Each library has an identity: sealed invites are sealed to it, and it signs what it sends. It is two P-256 key pairs made with WebCrypto `subtle` only: an ECDH pair (`encryptionKey`) for sealing and an ECDSA pair (`signingKey`) for signing. The private keys are device-local secrets, like a share key: VS Code keeps them in SecretStorage under `labshelf.collab.identity.<libraryId>`, the browser extension in `storage.local` beside `collabShares`. They never enter the library or a project.

- **Public keys** are written as base64url without padding of the raw uncompressed point (65 bytes, starting `0x04`).
- **Fingerprint**: the first 16 bytes of SHA-256 over the raw `encryptionKey` bytes followed by the raw `signingKey` bytes, as base64url without padding. It names the identity.
- **Canonical JSON** of an object is its JSON with keys sorted recursively and no whitespace.
- **Signature**: ECDSA P-256 with SHA-256 over the UTF-8 bytes of the canonical JSON of the signed object without its `sig` field, in IEEE P1363 form (`r || s`, 64 bytes, WebCrypto's own output), as base64url without padding.

## Sealed invite

A sealed invite carries an [invite link](#invite-link) to one identity, so it can travel through a channel that is not trusted, such as an inbox. Its label and additional data layout are frozen like the share key's labels, and the label is its own, distinct from those.

The envelope is JSON: `{v: 1, to, expires, epk, iv, ct}`.

- `to`: the recipient's fingerprint. `expires`: epoch ms.
- `epk`: a fresh ephemeral ECDH P-256 public key, raw base64url, one per invite.
- `iv`: 12 random bytes, base64url. `ct`: the AES-GCM ciphertext with its 16-byte tag, base64url.
- **Key**: HKDF-SHA-256 with the 32-byte ECDH shared secret of `epk` and the recipient's `encryptionKey` as input, the raw `epk` bytes as salt and the UTF-8 of `labshelf-invite-v1` as `info`, giving a 256-bit AES-GCM key.
- **Additional data**: the UTF-8 of `labshelf-invite-v1\n<to>\n<expires>`, with `expires` in decimal.

The plaintext is JSON: `{payload: {link, title, sender, created, expires}, sig}`. `link` is the invite link, `title` the project title, `sender` the sender's [card](#members), and `created` and `expires` epoch ms, with `expires` = `created` + 30 days. `sig` is the signature of `payload` by the key in `sender.signingKey`.

Opening refuses, each with its own typed error:

- a `to` that is not the opener's own fingerprint;
- a ciphertext that does not decrypt (tampered);
- a `sig` that does not verify;
- a `payload.expires` other than the envelope's `expires`;
- a time at or after `expires`;
- a `link` that the invite link check refuses.

Accepting an opened invite runs the ordinary [join](#membership) with the decoded link.

## Frame

Every payload is sealed in a frame. The additional data holds the share id, the doc key and the payload kind, so a frame opens only for the share, doc and kind it was sealed for and cannot be replayed into another doc. A frame that fails to open is dropped. The frame version byte is frozen with the layout.

## Messages

A message is a clear envelope followed by one frame. The envelope version is raised by any change to the envelope or to what a kind carries, and a receiver drops other versions.

- **Doc id**: the first 16 bytes of SHA-256 over `<share id>\0<doc key>` so a relay stores docs without learning file paths. A doc key is a file's POSIX path, or `/index`. The frame is sealed with the doc id in hex as its doc key, and its plaintext starts with the real doc key; a doc key that does not hash to the doc id is dropped.
- **Kinds**: sync steps, `update`, `ack`, `awareness` and `blob`. Kinds 5 to 15 are reserved, 16 to 255 belong to channels, and unknown kinds are dropped. Only `update` is stored by the relay; the rest are forwarded ([relay obligations](relay.md#client-obligations)).
- **Delivery**: sync steps and blobs are reliable, with an epoch (the sender's link to one peer, never lower than its last) and a per-link sequence. A receiver keeps only each peer's current epoch. Delivery is at least once and unordered, which Yjs tolerates.
- **Sync**: on connect each peer sends a state vector for every doc it holds, the index first. A peer ignores messages for docs it does not hold.
- **Blobs**: a blob is requested from one holder at a time and accepted only when its SHA-256 is the requested hash.
- **Awareness** carries each peer's relay state ([Relay list](#relay-list)) and is never stored. A peer state is `name`, `colour`, `file`, `anchor` and `head` (a string or null each), the optional relay fields and the optional `conversation`: null, or exactly `{path, typing}` with a `path` that starts with `discussions/` and ends `.qmd` (a Space conversation, Space-relative) or is `.labshelf/chat.qmd` (the project chat), and a boolean `typing`. A state with a `conversation` of any other shape is not shown; a state without the field is valid (older peers). `conversation` is set apart from the cursor fields and every later cursor update keeps it, so on a Space share it names the conversation the member has open and whether they are typing in it ([Spaces sharing](spaces.md#sharing)), and on a project share it is `.labshelf/chat.qmd` while the member has the project chat open. A member never reports typing in a chat they may only read.

## Project shares

### Docs

One Yjs doc per shared text file, keyed by its POSIX path, with its text in the `Y.Text` `content`, plus the index doc `/index`. A `.qmd` file's doc instead holds the `Y.Map` `qmd`: `order` (a `Y.Array` of segment keys: an item's id, `loose-<n>` for the n-th text outside items), `attrs` (key to the item's exact fence line, or the loose text), `bodies` (item key to its body as a y-prosemirror `Y.XmlFragment` of the [qmd-items.md](qmd-items.md) editor schema) and `tails` (item key to its closing line and body document attributes, as JSON). Writing the file serializes the segments in order; reading it changes only the items that changed, so concurrent edits of different items merge. The index holds these maps:

- `share`: `kind: "project"`, or `"space"` for a [Space share](#space-shares). A kind this version does not know is refused with a typed error, so a later kind never opens as a project or a Space.
- `files`: path to `{kind: "text" | "blob" | "qmd", hash?}`. Renames and deletes are edits here.
- `written`: path to the newest agreed disk versions, the mirror's record of what disk and doc last agreed on.
- `settings`, `comments`, `suggestions`, `relays`, `members`: see below.

A file is text when its extension is a known text extension and its bytes are UTF-8, else a blob; a `.qmd` file with UTF-8 bytes is `qmd`, one without is a blob. Shared files are what an export would hold, plus `labshelf.bib`, `.labshelf/checklist.json`, `.labshelf/citations.json`, `.labshelf/outputs.json` and the project chat `.labshelf/chat.qmd` (a `qmd` doc, [qmd-items.md](qmd-items.md#project-chat)), which exports, builds and the Files tree still leave out. `labshelf.yaml` and `.labshelf/comments.qmd` travel only through `settings`, and `comments` with `suggestions`. `.labshelf/citations.json` ([library-format.md](library-format.md#project-folder-labshelf)) is shared as a text file like `checklist.json`; a member whose copy no longer parses keeps the citations without scopes until the next write. `.labshelf/outputs.json` ([library-format.md](library-format.md#linked-outputs)) is shared the same way, and the copies under `outputs/` as blobs, so a member sees every linked output's preview; where each member's code lives is device-local and never shared. When a member's disk copy of a `qmd` file and its doc both changed, the mirror merges them item by item ([qmd-items.md](qmd-items.md#merge)), never line by line, so two messages sent at the same moment are both kept and no conflict copy or marker appears.

### Settings

The shared `labshelf.yaml` keys are the ones [library-format.md](library-format.md#labshelfyaml) lists as synced; the others stay per user. Each member writes the shared keys into its own file under the [labshelf.yaml rules](library-format.md#labshelfyaml). Sharing writes `title` when absent, because a joiner names its copy from it.

### Comments

A thread is a `Y.Map` with the keys of a [comments.qmd](library-format.md#project-folder-labshelf) thread; its comment bodies are LabShelf Markdown strings. Its `comments` is a `Y.Array`, so concurrent replies both survive. A live anchor adds `start` and `end` as Yjs relative positions in `content`; `start` binds right and `end` left, so text typed at either edge stays outside. Each mirror writes `.labshelf/comments.qmd` from the map, and sharing imports the existing file.

Pending suggestions live in the index's `suggestions` map, one `Y.Map` per suggestion keyed by its id, holding the fields of a [comments.qmd](qmd-items.md#comments) suggestion item: `kind` (`insert` or `delete`, the item's `suggestion` attribute), `file`, `anchor` (with `start` and `end` as for a thread), `text` (the deleted text, delete only), `group` (only on a replacement), `author` and `created`. Unknown keys are kept. The suggested text is already in the file's `content` (the proposal is applied); accepting deletes the entry, and rejecting first removes an insert's range or reinserts a delete's text at its position in `content`, then deletes the entry. The mirror writes the suggestions into the same `.labshelf/comments.qmd`, after the threads, and sharing seeds the map from the file's suggestion items.

### Bibliography

In a share the generator merges into `labshelf.bib` and never removes an entry, because a member without the paper would delete another's reference. It updates an entry with the same key only when it is the same work (same DOI, else same arXiv id, else the shared entry has neither), a rule every member must apply alike, and otherwise keeps it and logs the clash.

### Relay list

The `relays` array holds `{url, addedBy}` entries, in preference order. A member removes only their own. A client uses the index's list, or its invite's while that is empty.

All members must end on the same relay, or they cannot see each other. So each client publishes in awareness which relay it uses and which it holds down, and adopts every peer's marks, with a time cap so a peer cannot mute a relay for long. A relay goes down after a limit refusal from its host or repeated failures. One member keeps awareness-only sockets on the other relays, so a split group finds itself and moves together to the earlier relay. Cursors are per relay: moving to a relay catches up from cursor 0 and puts what that relay lacks. A client leaving a relay first waits, bounded, for its outstanding puts to be answered, so peers still on that relay receive them.

### Members

The `members` map holds contact cards, so members can send each other [sealed invites](#sealed-invite). Each entry is keyed by its card's [fingerprint](#identity) and holds a card as a JSON object:

`{name, email?, inboxUrl, inboxToken, encryptionKey, signingKey, updated, sig}`

- `name`, `inboxUrl`, `inboxToken`: strings; `email`: a string when present.
- `encryptionKey`, `signingKey`: the identity's public keys, raw base64url.
- `updated`: epoch ms of the card's last write.
- `sig`: the [signature](#identity) by `signingKey` over every other field of the card, unknown ones included.

Unknown keys are kept, signed and passed on. A client drops a card whose map key is not the fingerprint of its `encryptionKey` and `signingKey`, one with a required field missing or of the wrong type, and one whose `sig` does not verify.

A client writes only its own card, and removes it while the user has invitations turned off. The `inboxToken` is visible to every member of the project.

Keys are pinned per email on each device: the first `encryptionKey` and `signingKey` seen for an email, lowercased, are kept locally. A later card for that email with other keys is reported to the user as changed and is not adopted.

The local stores hold, per device:

- **Browser** (`storage.local`): `collabIdentity`, `collabContacts`, `collabInvitationsEnabled` and `collabEmailPins.<libraryId>`.
- **VS Code**: the identity in SecretStorage under `labshelf.collab.identity.<libraryId>`; in `globalState`, `labshelf.collab.contacts`, `labshelf.collab.invitationsEnabled` and `labshelf.collab.emailPins.<libraryId>`.

`ShareHost.contacts()` returns `{name, email?, fingerprint}` only, never keys or tokens. The sender email shown on an invitation comes only from these local pins, never from the invitation itself.

## Space shares

A Space share mirrors one folder `spaces/<space id>/` ([spaces.md](spaces.md)). Its index has `share.kind: "space"` and the `files`, `written`, `relays` and `members` maps of a [project share](#docs), with these differences:

- `files` holds only paths under `notes/` and `discussions/`, chart tables and figure PNGs included; a path with a hidden segment is not shared. `space.json` and `glossary.json` travel as the shared JSON below, never as files.
- There are no `settings`, `comments` or `suggestions` maps and no generated bibliography.
- The mirror's lease is `spaces/<space id>/.labshelf/mirror-lease.json` and its write records live in `spaces/<space id>/.labshelf/writes/`, as for a project folder.

### Shared JSON

`space.json` and `glossary.json` are merged by key and by entry, never as text, so two members adding papers at once both keep theirs. A file's shared part lives in root types of the index named by a prefix:

- `<prefix>`: a `Y.Map` of the shared top-level values.
- `<prefix>.<key>`: a `Y.Map` from entry id to the entry as a JSON object, one per shared array.
- `<prefix>.<key>.order`: a `Y.Array` of entry ids in file order. An id without an entry is skipped; an entry without an id in the order follows the ordered ones, sorted by id.

| File | Prefix | Values | Arrays (fields kept per user) |
| --- | --- | --- | --- |
| `space.json` | `space` | `name`, `purpose`, `createdAt` | `folders`, `papers` (`focus`), `dates`, `saved`, `agreements`, `seen` |
| `glossary.json` | `glossary` | none | `terms` |

Every other key stays per user and is never shared: in `space.json` `version`, `icon`, `archived`, `trashedAt`, `desk`, `projects`, `shared` and unknown keys; in `glossary.json` `version` and unknown keys. An array entry without a text id, or repeating an earlier id, stays in its member's file only.

The mirror writes a file as its member's file with the shared part put in: the member's own keys are kept, a shared entry keeps the member's per-user fields of the entry with the same id, and the member's entries without an id follow the shared ones. It reads a file's edits by comparing its shared part with the part the file and the index last agreed on in this run, and writes only the values and entries that differ, so a concurrent edit of another value or entry is kept. With no agreed part yet, a first look takes the index's part when the index holds one; otherwise the file's values and entries are added and nothing is removed. A new entry goes after the entry before it in the file. A `space.json` that its member's app cannot write (unreadable, or a newer `version`) is left as it is and its edits stay out of the share.

### Space projects

The index's `projects` map links the Space's projects: project share id to `{invite, title}`, where `invite` is the current [invite link](#invite-link) of the project's share and `title` its shared title. Each member's app keeps the map and its `space.json` `projects` (local project ids) in step:

- A project its member linked that is not shared is shared, then its entry is added. A linked project that is shared already adds its entry.
- An entry whose project this library lacks is joined from its invite, and the joined project is linked.
- An entry that leaves the map unlinks the project here, and a project unlinked here leaves the map. Unlinking never leaves the project's share.

Holding the Space's key gives every project's key, so every member of the Space is a member of its projects.

### Space papers

A `papers` entry may hold `info`, written by a member whose library holds the paper: `{title, authors?, year?, doi?, url?, pdf?}` with `authors` an array of strings, `year` a number and `pdf` `{sha256, bytes}` of the paper's PDF. A member whose library lacks the paper shows it from `info` and may download it, alone, with a Space folder (its subfolders included) or with the whole Space, into a library folder the user picks: a Space folder becomes a library folder of the same name inside the picked one. The PDF is fetched by its `sha256` from the peers through the blob channel; a member serves the PDF of every paper of the Space its library holds whose SHA-256 matches. A paper downloaded under its entry's id is the entry's paper; a library that holds the same work under another id imports nothing and keeps the entry missing.

## Device-local state

Per share, under `collab/<share id>/` in the library's [state folder](library-format.md#device-local-files) and never in the library, where a sync tool would make conflict copies. It holds each doc's snapshot and update log, blobs, the last agreed text of each file, and the relay cursors and held state. The browser keeps the same records in IndexedDB.

- The log is append-only and folded into a snapshot on open. A torn last record is dropped. After a failed append the doc writes nothing until a full snapshot replaces the log.
- An edit is durable once its append (or IndexedDB transaction) completes.
- A relay cursor is saved only after every update received so far is stored.

The editor's review mode (editing or reviewing) is per user and project and never travels in a share: the browser keeps it in local storage, VS Code in `workspaceState` under `labshelf.reviewMode.<projectId>`. The VS Code source editor page asks its host to add or remove suggestions and to store the mode; the host answers with the file's suggestion list.

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
