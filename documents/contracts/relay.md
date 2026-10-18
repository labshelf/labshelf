# Contract: relay

Read when you change the owner's relay Worker, a client that talks to it, or the messages between them.

A relay is a Cloudflare Worker that a project owner deploys into their own account. It stores the encrypted messages of a [share](collaboration.md#messages), forwards them over WebSocket when peers cannot reach each other or the mesh is full, and mints TURN credentials. It never holds a key and never decodes Yjs: it sees share ids, doc ids, sizes and timing, never content. One Durable Object holds one share. Core's `relay` module is the one implementation of this protocol.

## Versions

- The protocol version is `major.minor`, two decimal integers, currently `1.0`. Every HTTP body and every socket message carries it.
- A client talks to any Worker of the same major. A minor adds only optional fields and message types that a peer of a lower minor may miss without harm, so a Worker never breaks an older client and a newer client works against an older Worker.
- A receiver ignores fields it does not know: JSON keys, and bytes after the fields it reads in a socket message.
- A body or message of another major is refused: the Worker answers `incompatibleVersion`, and a client stops with the typed error `incompatibleRelay`, which tells the user to update LabShelf or the relay.
- `/version` also reports the Worker build, `<major>.<minor>.<patch>`, whose `major.minor` is the protocol version it serves. Clients use it to update the Worker and never install a lower build.

## Auth

- `OWNER_SECRET` is a Worker secret set by the owner's LabShelf at deploy and kept on the owner's devices only. It authorises `/claim`.
- A share's relay token is the `relay` key of [collaboration.md](collaboration.md#share-key). The Worker stores only its `relayTokenHash`: SHA-256 over the token's 32 decoded bytes, as 64 lowercase hex characters.
- A ticket is `<expires>.<mac>`: `expires` is a Unix time in seconds, 5 minutes after minting, and `mac` is HMAC-SHA-256, base64url without padding, over the UTF-8 of `<share id>|<expires>`, keyed with HKDF-SHA-256 over the UTF-8 of `OWNER_SECRET` with an empty salt, `info` `ticket` and 32 bytes. Clients treat a ticket as opaque. The Worker checks it when a socket opens and on `/turn`; an open socket outlives its ticket.

## Endpoints

Bodies are UTF-8 JSON. A share id is 32 lowercase hex characters. Every endpoint answers a CORS preflight and allows any origin, since no cookie is involved.

| Request | Body | Answer |
|---|---|---|
| `GET /version` | none; public | `200 {v, worker}` |
| `POST /claim`, `Authorization: Bearer <OWNER_SECRET>` | `{v, shareId, relayTokenHash}` | `200 {v}`; the same hash again is a no-op |
| `POST /ticket` | `{v, shareId, relayToken}` | `200 {v, ticket, expires}` |
| `GET /project/<share id>?ticket=<ticket>` | WebSocket upgrade | `101`, then [socket messages](#socket-messages) |
| `POST /turn` | `{v, shareId, ticket}` | `200 {v, iceServers, expires}` |

- `iceServers` is a WebRTC `RTCIceServer` list: `{urls, username?, credential?}`, `urls` a string or a list of strings. The Worker mints them from its TURN key with a TTL of one hour; `expires` is their Unix expiry in seconds.
- A refusal is `{v, error}` with one of these codes:

| Status | `error` | When |
|---|---|---|
| 400 | `malformed` | the body is not the JSON the endpoint takes |
| 400 | `incompatibleVersion` | `v` has another major |
| 401 | `unauthorized` | a wrong owner secret, or a missing, bad or expired ticket |
| 403 | `forbidden` | an unclaimed share, or a relay token whose hash is not the share's |
| 409 | `claimed` | `/claim` of a share claimed with another hash |
| 503 | `turnUnavailable` | `/turn` on a relay without a TURN key, or when Cloudflare does not mint credentials |

A client reads an unknown code as a refusal of the request it made.

## Socket messages

Socket messages are binary WebSocket messages; a text message is a protocol error the Worker ignores. The stored payloads are binary frames, so binary avoids base64's third more of bytes, which the free plan bills as storage and rows read, and keeps the Worker free of a JSON pass per message.

```
major (1 byte) | minor (1 byte) | type (1 byte) | fields
```

- Integers are big-endian and unsigned. `doc` is a doc id: 16 bytes on the wire, 32 lowercase hex characters in the decoded message, the one of the message envelope. A `frame` is a 4-byte length and that many bytes, at least one; it is a whole share message (envelope and frame), opaque to the relay. A `cursor` is 4 bytes: the free plan writes at most 100,000 rows a day, which a 4-byte cursor outlasts by a century. A peer `id` is 4 bytes, assigned by the Durable Object per connection and never reused within it.
- A message is at most 1 MiB. The Worker pages a `rows` answer to stay under it and refuses a larger message with `tooLarge`. It also refuses a `put` or `snapshot` whose frame exceeds 1 MiB less 32 bytes, so that every stored frame fits a `rows` answer.

| Type | Message | Direction | Fields |
|---|---|---|---|
| 1 | `put` | client → relay | `doc`, `frame` |
| 2 | `since` | client → relay | `doc`, `cursor` |
| 3 | `snapshot` | client → relay | `doc`, `covers` (a cursor), `frame` |
| 4 | `forward` | client → relay | `to` (a peer id, `0` for every other peer), `frame` |
| 16 | `accepted` | relay → client | `doc`, `cursor` |
| 17 | `stored` | relay → client | `from` (peer id), `doc`, `cursor`, `frame` |
| 18 | `rows` | relay → client | `doc`, flags (1 byte: bit 0 `more`, bit 1 snapshot follows), then with bit 1 `covers` and `frame`, then a 4-byte count and per row `cursor` and `frame` |
| 19 | `forwarded` | relay → client | `from`, `frame` |
| 20 | `peers` | relay → client | a 4-byte count and that many peer ids |
| 21 | `joined` | relay → client | `id` |
| 22 | `left` | relay → client | `id` |
| 23 | `error` | relay → client | `code` (1 byte), `doc` (all zeros when no doc is involved) |

- `put` stores the frame under the doc with the next cursor of the share, answers `accepted` with that cursor and sends `stored` to every other peer.
- `since` answers with `rows`: the doc's snapshot when its `covers` is above the cursor, then the stored rows above the larger of the cursor and `covers`, in cursor order. Cursor `0` asks for everything. With `more` set, the client asks again from the last cursor it received.
- `snapshot` replaces the doc's snapshot and deletes its rows at or below `covers`, then answers `accepted` with `covers`. A snapshot whose `covers` is not above the stored one's, or is above the doc's last cursor, is refused with `staleSnapshot`.
- `forward` sends `forwarded` to the peer `to`, or to every other peer, and stores nothing. A `to` that is not connected drops the message.
- When a socket opens, the Durable Object sends it `peers` with the other connected peers and sends `joined` to them; when it closes, the others get `left`.
- `error` codes: 1 `malformed`, 2 `incompatibleVersion`, 3 `tooLarge`, 4 `staleSnapshot`. A client reads an unknown code as a refusal of its last request for that doc.
- A receiver ignores a message of an unknown type, so a newer minor can add types. A malformed message is ignored too; the Worker answers it with `malformed`.

## Client obligations

The free plan allows 100,000 Worker and Durable Object requests a day and 100,000 rows written, and bills incoming socket messages at 20 to 1; per-keystroke writes exhaust it within a day. Every client:

- puts `update` messages only, with `seq` 0, and batches them: at most one `put` per doc every 2 s while the user types, merging the updates in between, and flushing when typing stops and before the socket closes;
- sends awareness, acknowledgements and sync steps with `forward`, never with `put`;
- writes a `snapshot`, a `syncStep2` message with `seq` 0 holding the doc's whole state, after 500 `put`s of a doc since its last snapshot, only when it holds every row up to `covers`;
- asks `since` for the index doc and then for every doc it holds when its socket opens, from the last cursor it received for that doc;
- reconnects with exponential backoff, because a Worker update can drop a socket at any time;
- reads `/version` at most once per app start and once before it moves to a relay, and a ticket only to open a socket or ask for TURN credentials.

## Deploy

LabShelf uploads the Worker through the Cloudflare API with a token the owner pastes; the request sequence is in the [Cloudflare research](../plans/project-collaboration/research/cloudflare-free-plan.md#request-sequence-verified).

- A deployment has a Durable Object binding `ROOM` (class `Room`, SQLite-backed), a KV binding `KV`, and three secrets: `OWNER_SECRET`, `TURN_KEY_ID` and `TURN_KEY_SECRET`. The Worker is reachable at `https://<worker>.<subdomain>.workers.dev`.
- An update uploads the script again with the same bindings, keeps the secrets (`keep_bindings: ["secret_text"]`) and sends no migrations, so stored rows survive.
- Once per app start the owner's LabShelf compares the `worker` build of `/version` with its bundled build, as numbers in the order major, minor, patch. A deployed build below the bundled one is updated; an equal or higher one is left alone, so a Worker is never downgraded.
- A deploy that fails midway can be repeated: it reuses the KV namespace with its title and deletes TURN keys with its name before minting one, since a TURN secret is shown only once.

## Clients

How a LabShelf client meets these obligations alongside the peer-to-peer mesh of [collaboration.md](collaboration.md#sync):

- A share with a relay opens one share session over the mesh transport merged with the relay transport, so peer-to-peer and relay peers sync at the same time. Each other relay connection is a session peer: sync steps, acknowledgements, awareness and blobs reach it through `forward`, and a relay peer does not count toward the mesh limit, since it costs no direct link.
- The mesh sends a relay peer no `update` messages. The relay sync, a layer beside the session that holds the content key, puts every local update of a doc instead: it merges the updates of a 2 s window into one `update` message with `seq` 0, sealed once, and puts it at the window's end, before the socket closes, and again after a reconnect when the relay never answered it. Other peers apply a `stored` or `rows` frame like any update from a peer; it is never acknowledged or resent, since the relay holds it.
- The relay transport holds no key. It sends an awareness message to a peer at most once a second, keeping only the latest, because each one carries the sender's whole presence.
- When its socket opens, the relay sync asks `since` for the index doc, then for each held doc, and for a doc opened later when it opens. It saves a doc's cursor only after applying the rows below it, through a cursor store the caller persists with the doc state; without one, every start asks from cursor 0. After a catch-up from cursor 0 it puts what the device holds beyond the relay's rows, which seeds a fresh relay with the owner's project.
- A device writes a doc's snapshot after it has seen 500 rows of the doc stored since the last snapshot, and only once it has caught up on the open socket.
- A share with several relays uses one at a time, chosen and switched as the [relay list](collaboration.md#relay-list) says.
- The relay transport fetches a ticket for each socket and reconnects with exponential backoff from 1 s to 60 s, logging each drop. It stops on a relay of another major. The app fetches TURN credentials with its own ticket and passes them to the trystero transport as `turnConfig`.
