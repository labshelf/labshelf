# Contract: relay

Read when you change the owner's relay Worker, a client that talks to it, or how LabShelf deploys it.

A relay is a Cloudflare Worker the project owner deploys into their own account. It stores the encrypted messages of a [share](collaboration.md#messages) and forwards them over WebSocket. It never holds a key and sees only share ids, doc ids, sizes and timing. One Durable Object holds one share. Workers and clients update separately, so both sides follow every rule here.

## Versions

- The protocol is `major.minor`, carried by every HTTP body and socket message. Removing or reshaping an endpoint, field or message raises the major. A minor only adds optional fields and message types.
- A client works with any Worker of its major. Receivers ignore unknown JSON keys, unknown message types and trailing bytes.
- Another major is refused: the Worker answers `incompatibleVersion`, and the client stops and tells the user to update LabShelf or the relay.
- `GET /version` returns the Worker build `<major>.<minor>.<patch>`; the patch counts Worker changes that keep the protocol. Its optional field `migrationTag` names the last Durable Object migration the Worker has applied ([Deploy](#deploy)). A missing `migrationTag` means no migration is applied, so an update sends every step; the client refuses a tag it does not recognise and tells the user to update LabShelf.
- No compatibility with earlier protocol versions, Workers or stored accounts is kept while LabShelf has no real users.

## Auth

- The owner secret is a Worker secret set at deploy and kept only on the owner's devices. It authorises `/claim` on the relay Worker. The share Worker has its own owner secret, which authorises the owner requests of [share links](share-link.md#worker-endpoints); the two secrets are independent.
- A share's first `/claim` stores the SHA-256 of its relay token (hex of the decoded bytes), so the Worker never holds the token. Another hash for a claimed share is refused.
- `/ticket` trades a relay token for a short-lived signed ticket, an HMAC keyed from the owner secret. It is checked only when a socket opens; an open socket outlives it. Clients treat it as opaque.

## Endpoints

UTF-8 JSON bodies, answered to any origin (no cookies are involved). A client reads an unknown error code as a refusal.

- `GET /version`: public.
- `POST /claim`: owner secret as bearer.
- `POST /ticket`: relay token.
- `GET /project/<share id>?ticket=<ticket>`: WebSocket upgrade.

The relay Worker does not serve `/share/*`; those paths belong to the [share Worker](share-link.md#worker-endpoints) and the relay refuses them.

## Socket messages

Binary only; a text message is ignored. Binary avoids base64, which adds a third to every stored frame. Every message starts with `major`, `minor` and a type byte. A message is at most 1 MiB, and stored frames are smaller by a margin so every stored frame fits a `rows` answer.

- `put` stores a frame under the share's next cursor, answers `accepted` and sends `stored` to the other peers.
- `since` answers `rows` above a cursor, preceded by the doc's snapshot when its `covers` is above the cursor. With `more`, ask again from the last cursor.
- `snapshot` replaces the doc's snapshot and deletes the rows it covers. A `covers` that is not above the stored one, or is past the last cursor, is refused `staleSnapshot`.
- `forward` delivers a frame to one peer or all others and stores nothing.
- On open the new socket gets the peer list and the others `joined`; on close they get `left`.

## Client obligations

The free plan bills per request and per row written, and counts incoming socket messages, so per-keystroke writes would exhaust it. Every client:

- `put`s only `update` messages (epoch and seq 0), at most one per doc at a time while typing, merging updates in between, flushed when typing stops, before the socket closes and again after a reconnect if never accepted; a client leaving a relay waits, bounded, for the relay to answer its outstanding puts before closing;
- sends sync steps, acks, awareness and blobs with `forward`, never `put`;
- on socket open asks `since` for the index, then each held doc, from its last saved cursor, and saves a cursor only after applying the rows below it;
- after catch-up puts what the doc holds beyond the state the relay is known to hold, so offline edits reach the relay and a fresh relay is seeded;
- writes a `snapshot` (a `syncStep2` with epoch and seq 0 holding the whole doc) after many rows since the last one, only when caught up and holding the lowest awareness id it sees; `staleSnapshot` is expected;
- fetches a ticket per socket, and reconnects with backoff.

## Deploy

The owner's LabShelf uploads two Workers through the Cloudflare API: the relay Worker and a separate [share Worker](share-link.md#worker-endpoints) that serves paper share links.

- Sign-in is OAuth Authorization Code with PKCE. The redirect `http://127.0.0.1:8976/callback` is registered with Cloudflare and must match exactly, so the port cannot change. After the exchange the browser is sent to `https://labshelf.org/connected/?service=cloudflare` (`&error=<code>` on failure), never with a token or code.
- TRAP: Cloudflare rotates the refresh token on every refresh, and two refreshes with one token can revoke the grant. New tokens are stored before use and one refresh runs at a time.
- Without a reachable loopback port (SSH, Codespaces) the owner pastes an API token with the same permissions as the OAuth scopes.
- Each Worker gets a random script name `ls-<12 lowercase base32 chars>` drawn with `crypto.getRandomValues`. Script names do not appear in certificate logs, so the Worker hosts cannot be guessed. The relay account stores the relay Worker's name as the required field `workerName`.
- The relay Worker has a SQLite-backed Durable Object, a KV namespace titled `labshelf-relay` (bound but not used by the relay endpoints) and the owner secret. The share Worker has its own name, KV namespace titled `labshelf-share`, owner secret, entry and bundle; the relay account stores it as the required field `shareWorker {name, url, ownerSecret, kvNamespaceId}`. An account missing `workerName` or `shareWorker` is invalid, and the owner connects again; no earlier account, Worker or protocol version is kept compatible.
- Connect deploys both Workers. A failed deploy can be repeated; it reuses each KV namespace by title.
- Durable Object migrations are a list of tagged steps in core. An update re-uploads the relay Worker keeping its secrets and sends only the steps after the deployed tag, which the Worker reports in `GET /version` ([Versions](#versions)), so new classes reach deployed Workers and stored rows survive.
- The owner's app updates a deployed Worker only when its bundled build is higher. The share Worker is never rotated, so rotating the relay Worker keeps public links working.
- Rotation (`rotateRelay`, from a command or on detected abuse) runs under the same lock as the start-up update and the retirement (the browser's update lock; in VS Code the lifecycle lock, which also covers update and retire). In order, it: deploys a relay Worker with a new name; stores it as the current relay, with the old one as `retiring {workerName, relayUrl, ownerSecret, kvNamespaceId, retireAfter}` where `retireAfter` is the rotation time + 24 h; waits until the new relay serves; offers it to every share (connected ones claim it and list it, stored invites of unconnected shares gain it); waits `RELAY_LISTING_WAIT_MS` (10 s) so the listing reaches collaborators through the old relay, which the owner's devices leave as soon as it is withdrawn; withdraws the old address from the lists and stored invites; and calls the optional directory-registration callback. A rotation finds a relay still `retiring` within its grace period and reports it pending instead of rotating again.
- Both relays bind the one KV namespace titled `labshelf-relay`. `retireRelayIfDue` (at start-up and hourly) deletes the retiring Worker's script once `now >= retireAfter`, never before. It deletes the old KV namespace only when its id differs from the current relay's, and then clears `retiring`. A failed deletion keeps the field, so the next check retries. A disconnect also deletes a retiring relay.
- The abuse check (`decideAbuseRotation`) rotates past 60% of the free plan's 100,000 daily requests before 12:00 UTC, past 80% at any time, or after a 1027 limit refusal. It reads the relay script's requests of the current UTC day from GraphQL `workersInvocationsAdaptive`.
- App bundles that define `RELAY_WORKER_SCRIPT` also define `SHARE_WORKER_SCRIPT`.
- A disconnect takes the relay out of the shares, deletes both Workers and their KV namespaces, and only then forgets the account, so a failed deletion can be retried.
