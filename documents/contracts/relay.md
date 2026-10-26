# Contract: relay

Read when you change the owner's relay Worker, a client that talks to it, or how LabShelf deploys it.

A relay is a Cloudflare Worker the project owner deploys into their own account. It stores the encrypted messages of a [share](collaboration.md#messages) and forwards them over WebSocket. It never holds a key and sees only share ids, doc ids, sizes and timing. One Durable Object holds one share. Workers and clients update separately, so both sides follow every rule here.

## Versions

- The protocol is `major.minor`, carried by every HTTP body and socket message. Removing or reshaping an endpoint, field or message raises the major. A minor only adds optional fields and message types.
- A client works with any Worker of its major. Receivers ignore unknown JSON keys, unknown message types and trailing bytes.
- Another major is refused: the Worker answers `incompatibleVersion`, and the client stops and tells the user to update LabShelf or the relay.
- `GET /version` also reports the Worker build `<major>.<minor>.<patch>`; the patch counts Worker changes that keep the protocol.

## Auth

- The owner secret is a Worker secret set at deploy and kept only on the owner's devices. It authorises `/claim` and the owner requests of [share links](share-link.md#worker-endpoints).
- A share's first `/claim` stores the SHA-256 of its relay token (hex of the decoded bytes), so the Worker never holds the token. Another hash for a claimed share is refused.
- `/ticket` trades a relay token for a short-lived signed ticket, an HMAC keyed from the owner secret. It is checked only when a socket opens; an open socket outlives it. Clients treat it as opaque.

## Endpoints

UTF-8 JSON bodies, answered to any origin (no cookies are involved). A client reads an unknown error code as a refusal.

- `GET /version`: public.
- `POST /claim`: owner secret as bearer.
- `POST /ticket`: relay token.
- `GET /project/<share id>?ticket=<ticket>`: WebSocket upgrade.

## Socket messages

Binary only; a text message is ignored. Binary avoids base64, which adds a third to every stored frame. Every message starts with `major`, `minor` and a type byte. A message is at most 1 MiB, and stored frames are smaller by a margin so every stored frame fits a `rows` answer.

- `put` stores a frame under the share's next cursor, answers `accepted` and sends `stored` to the other peers.
- `since` answers `rows` above a cursor, preceded by the doc's snapshot when its `covers` is above the cursor. With `more`, ask again from the last cursor.
- `snapshot` replaces the doc's snapshot and deletes the rows it covers. A `covers` that is not above the stored one, or is past the last cursor, is refused `staleSnapshot`.
- `forward` delivers a frame to one peer or all others and stores nothing.
- On open the new socket gets the peer list and the others `joined`; on close they get `left`.

## Client obligations

The free plan bills per request and per row written, and counts incoming socket messages, so per-keystroke writes would exhaust it. Every client:

- `put`s only `update` messages (epoch and seq 0), at most one per doc at a time while typing, merging updates in between, flushed when typing stops, before the socket closes and again after a reconnect if never accepted;
- sends sync steps, acks, awareness and blobs with `forward`, never `put`;
- on socket open asks `since` for the index, then each held doc, from its last saved cursor, and saves a cursor only after applying the rows below it;
- after catch-up puts what the doc holds beyond the state the relay is known to hold, so offline edits reach the relay and a fresh relay is seeded;
- writes a `snapshot` (a `syncStep2` with epoch and seq 0 holding the whole doc) after many rows since the last one, only when caught up and holding the lowest awareness id it sees; `staleSnapshot` is expected;
- fetches a ticket per socket, and reconnects with backoff.

## Deploy

The owner's LabShelf uploads the Worker through the Cloudflare API.

- Sign-in is OAuth Authorization Code with PKCE. The redirect `http://127.0.0.1:8976/callback` is registered with Cloudflare and must match exactly, so the port cannot change. After the exchange the browser is sent to `https://labshelf.org/connected/?service=cloudflare` (`&error=<code>` on failure), never with a token or code.
- TRAP: Cloudflare rotates the refresh token on every refresh, and two refreshes with one token can revoke the grant. New tokens are stored before use and one refresh runs at a time.
- Without a reachable loopback port (SSH, Codespaces) the owner pastes an API token with the same permissions as the OAuth scopes.
- The Worker is `labshelf-relay`, with a SQLite-backed Durable Object, a KV namespace and the owner secret. An update re-uploads the Worker keeping its secrets and runs no migrations, so stored rows survive. A failed deploy can be repeated; it reuses the KV namespace by title.
- The owner's app updates the deployed Worker only when its bundled build is higher.
- A disconnect takes the relay out of the shares, deletes the Worker, and only then forgets the account, so a failed deletion can be retried.
