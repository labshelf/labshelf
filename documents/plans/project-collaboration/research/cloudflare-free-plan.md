sha: 3159f508
files: none in the repo yet (packages/core/src/relay/** after session 6)
source: Cloudflare docs as summarised by the user, 2026-10-17; YAOS issue #40; not re-read by the planner

# Cloudflare free plan and the owner's relay

## Limits (official docs, per the user; session 1 re-checks the links)
- Workers: 100k requests/day, 10 ms CPU per request, 128 MB memory, 100 MB request body.
- Durable Objects on Free: SQLite-backed only; 100k requests/day; incoming WebSocket messages billed 20:1, outgoing free; duration 13,000 GB-s/day (~29 h of one active 128 MB object; hibernating objects are not billed); 5 GB storage; 100k rows written/day; 5M rows read/day. Use the WebSocket Hibernation API.
- KV: 1 GB, 1,000 writes/day, 100k reads/day, 25 MiB per value; eventually consistent (~60 s).
- R2: 10 GB free, probably needs a payment method (unverified) — not used.
- TURN (Cloudflare Realtime): 1,000 GB/month free, shared with SFU; $0.05/GB after. Credentials are minted by the Worker per session with a short TTL.
- Runtime updates may drop WebSockets after up to 20 min: clients reconnect with backoff.

## Budget rules the Worker and clients follow
- Clients batch updates: at most one relay write per document per 2 s while typing, flushed on idle and on close. YAOS #40 shows per-keystroke writes exhaust 100k requests/day.
- Awareness (cursors) goes P2P only, never stored; over the relay it is forwarded, not written.
- Compaction is client-side: a client that holds the full state writes an encrypted snapshot and the relay drops the updates it covers (secsync model). The relay never decodes Yjs.
- One Durable Object per shared project; hibernates when idle.

## Deploy through the API (no "Deploy to Cloudflare" button)
- The button clones into the user's GitHub with no update path, so LabShelf uploads the Worker itself: multipart script upload with metadata (main module, compatibility date, DO binding + migration tag, KV binding), then enables the `workers.dev` route.
- The user pastes an API token once; it lives in VS Code `SecretStorage` (OS keychain). The token template and exact permissions (Workers Scripts:Edit, Workers KV Storage:Edit, account read, Realtime TURN) are unverified: session 1 tests them on a scratch account the user creates.
- On every LabShelf start: read the deployed Worker's `/version`; if older than the bundled one, upload. The Worker protocol is versioned (`v` in every message, `/version` endpoint); a newer client talks to an older Worker within the same major version; a Worker never breaks an older client.
- The Worker stays a few hundred lines: store/forward ciphertext, list updates since a cursor, snapshots, HMAC tickets, TURN credentials, share-link blobs.

## Auth (YAOS precedent, adapted)
- Owner claims the Worker on first deploy: LabShelf sets a random owner secret as a Worker secret.
- Each shared project gets a relay token derived from the project key (HKDF, label `relay`); the Worker stores only its hash. Clients exchange it for a short-lived HMAC WebSocket ticket. The relay sees the project's opaque id, sizes and timing, never content.

## Unverified
- Cloudflare ToS on one person holding several accounts; whether `workers.dev` is blocked on some university networks; exact multipart format for DO migrations; free-plan TURN without a card.
