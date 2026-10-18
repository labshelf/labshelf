sha: 3159f508
files: none in the repo yet (packages/core/src/relay/** after session 6)
source: Cloudflare docs re-read 2026-10-17 (links inline); YAOS issue #40; deploy recipe run end to end on two fresh free accounts on 2026-10-17

# Cloudflare free plan and the owner's relay

## Limits ([Workers](https://developers.cloudflare.com/workers/platform/limits/), [DO](https://developers.cloudflare.com/durable-objects/platform/pricing/), [KV](https://developers.cloudflare.com/kv/platform/limits/), [Realtime](https://developers.cloudflare.com/realtime/pricing/))
- Workers: 100k requests/day (reset 00:00 UTC, then error 1027), 10 ms CPU per request, 128 MB memory, 100 MB request body, 50 subrequests per invocation, 100 Workers per account.
- Durable Objects on Free: SQLite-backed only; 100k requests/day; incoming WebSocket messages billed 20:1, outgoing free; duration 13,000 GB-s/day (~29 h of one active 128 MB object; hibernating objects are not billed); 5 GB storage; 100k rows written/day; 5M rows read/day. Use the WebSocket Hibernation API.
- KV: 1 GB, 1,000 writes/day, 1 write/s to the same key, 100k reads/day, 25 MiB per value, 512-byte keys; eventually consistent.
- R2: 10 GB free, probably needs a payment method (unverified) — not used.
- TURN (Cloudflare Realtime): the first 1,000 GB/month are free and SFU and TURN share that allowance; $0.05/GB after. Credentials are minted by the Worker per session with a short TTL.
- A free account needs no payment method for Workers, Durable Objects, KV, the `workers.dev` subdomain or a TURN key (checked on two fresh accounts).
- Creating an OAuth client needs a verified email: the "Create client" button stays disabled until then.
- Runtime updates may drop WebSockets after up to 20 min: clients reconnect with backoff.

## Budget rules the Worker and clients follow
- Clients batch updates: at most one relay write per document per 2 s while typing, flushed on idle and on close. YAOS #40 shows per-keystroke writes exhaust 100k requests/day.
- Awareness (cursors) goes P2P only, never stored; over the relay it is forwarded, not written.
- Compaction is client-side: a client that holds the full state writes an encrypted snapshot and the relay drops the updates it covers (secsync model). The relay never decodes Yjs.
- One Durable Object per shared project; hibernates when idle.

## Deploy through the API (no "Deploy to Cloudflare" button)
- The button clones into the user's GitHub with no update path, so LabShelf uploads the Worker itself.
- The user signs in to Cloudflare from LabShelf; nobody pastes a token. Cloudflare OAuth supports desktop apps through Authorization Code + PKCE (`S256`, token auth method `none`, no client secret) ([create an OAuth client](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)). Endpoints: `https://dash.cloudflare.com/oauth2/auth`, `/oauth2/token`. The `scope` parameter is required: without it the consent screen shows 0 permissions and cannot be approved. The account id comes from `GET /client/v4/accounts`.
- Redirect URLs must be `http://` or `https://`: `vscode://` is rejected, so the extension listens on a loopback port (`http://127.0.0.1:<port>/callback`, registered exactly, port included). A remote host would need an `https` page on the LabShelf website that forwards to `vscode://`.
- Scopes (ids from `GET /client/v4/oauth/scopes`): `workers-scripts.admin` ("Workers Admin"), `workers-kv-storage.write`, `realtime.write`, `account-settings.read`. "Workers Editor" (`workers-scripts.edit`) can read but gets 403 on script upload; "Workers Scripts Write" exists in the API list but not in the dashboard's client form. Durable Objects have no scope of their own. The OAuth server validates scopes before login: an unregistered id redirects with `invalid_scope` naming it.
- With the client's grant types set to Authorization Code and Refresh Token, `offline_access` is allowed and the token response adds a `refresh_token` (verified 2026-10-18 on two accounts). `expires_in` is 3600. A `refresh_token` grant (`client_id`, no secret) returns a new access token and a new refresh token, and the old refresh token stops being valid; a refresh 65 min after sign-in, with the access token already refused (403 "Invalid access token"), succeeded. How long an unused refresh token lives is not documented.
- LabShelf's client: id `6bf60d8231e753c5249c7044aa0c4aff`, in the `labshelf@proton.me` account, redirect `http://127.0.0.1:8976/callback`, client URL `https://labshelf.org` (verified by a `cloudflare_oauth_client_publisher=` TXT record), logo `https://labshelf.org/media/labshelf-logo.png`, policy `https://labshelf.org/#s9`, public since 2026-10-18 (permanent; the client URL's domain can no longer change). A private client refuses other accounts with "This is a private application and can only be authorized by members of the developer's account".
- An auth request with an unknown scope and no `redirect_uri` redirects to the registered redirect with `invalid_scope`, which reveals the registered URL without signing in.
- The Worker protocol is versioned (`v` in every message, `/version` endpoint); a newer client talks to an older Worker within the same major version; a Worker never breaks an older client.
- The Worker stays a few hundred lines: store/forward ciphertext, list updates since a cursor, snapshots, HMAC tickets, TURN credentials, share-link blobs.

### Request sequence (verified; `$A` = `https://api.cloudflare.com/client/v4/accounts/<id>`, Bearer = OAuth token)
1. `POST $A/storage/kv/namespaces` `{"title": "..."}` → `result.id`.
2. `GET $A/workers/subdomain`; on 404 (code 10007, fresh accounts have none) `PUT $A/workers/subdomain` `{"subdomain": "..."}`. Upload fails with 403 code 10063 until a subdomain exists.
3. `PUT $A/workers/scripts/<name>`, `multipart/form-data`: part `metadata` (`application/json`) and part `worker.js` (`application/javascript+module`, filename `worker.js`). First upload metadata: `{"main_module":"worker.js","compatibility_date":"2026-10-01","bindings":[{"type":"durable_object_namespace","name":"ROOM","class_name":"Room"},{"type":"kv_namespace","name":"KV","namespace_id":"<id>"}],"keep_bindings":["secret_text"],"migrations":{"new_tag":"v1","new_sqlite_classes":["Room"]}}`. Updates send the same without `migrations`; DO data and the secret survive. A new version serves within ~5 s.
4. `PUT $A/workers/scripts/<name>/secrets` `{"name":"OWNER_SECRET","text":"...","type":"secret_text"}` → 201.
5. `POST $A/workers/scripts/<name>/subdomain` `{"enabled":true,"previews_enabled":false}`. A new account subdomain answers TLS after 90–130 s (handshake failure before).
6. TURN: `POST $A/calls/turn_keys` `{"name":"..."}` → 201 `{uid, name, secret}`; the `secret` is shown only here and becomes a Worker secret. The Worker calls `POST https://rtc.live.cloudflare.com/v1/turn/keys/<uid>/credentials/generate-ice-servers` with `Authorization: Bearer <secret>` and `{"ttl": 3600}` → 201 `iceServers`: STUN `stun.cloudflare.com:3478/443`, TURN `turn:`/`turns:` on 3478 udp/tcp, 5349, 443 udp/tcp, 80 tcp, with `username` and `credential`.
7. Delete: `DELETE $A/workers/scripts/<name>?force=true`, `DELETE $A/storage/kv/namespaces/<id>`, `DELETE $A/calls/turn_keys/<uid>`.

## Auth (YAOS precedent, adapted)
- Owner claims the Worker on first deploy: LabShelf sets a random owner secret as a Worker secret.
- Each shared project gets a relay token derived from the project key (HKDF, label `relay`); the Worker stores only its hash. Clients exchange it for a short-lived HMAC WebSocket ticket. The relay sees the project's opaque id, sizes and timing, never content.

## Unverified
- Whether `workers.dev` is reachable on university networks (session 1.5). With the relay as the only transport (D4) a network that blocks it has no fallback.
- The [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/) forbids creating accounts with scripts and circumventing usage limits; it states no one-account-per-person rule. Each owner uses their own account, so LabShelf does not depend on it.
