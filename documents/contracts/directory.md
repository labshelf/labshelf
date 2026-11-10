# Contract: directory

Read when you change the LabShelf directory that delivers first-contact invites by email, a client that talks to it, its limits or how it is deployed.

The directory lets a user invite someone by email when the two have never exchanged an invite link. It maps a keyed email to the recipient's inbox and public keys, and forwards a sealed invite to that inbox for the sender. It runs on the Cloudflare free plan (Workers Free and D1 free) and never leaves it: when a limit refuses, the app falls back to the invite link and says so. Clients call it only when the user acts; they never poll.

## Hosting

- The directory runs in the `labshelf-website` Worker with a D1 database. `assets.run_worker_first` is `["/api/*"]`, so only `/api/*` reaches the Worker code; every other path is a static asset.
- Worker secrets: `DIRECTORY_SECRET` (the HMAC key for email keys) and `DIRECTORY_SIGNING_KEY` (the directory's ECDSA P-256 private key, PKCS#8 PEM). The matching public key is built into the [relay Worker](relay.md), which checks every forward ([Forward](#forward)).
- The Worker and the D1 database are deployed by hand with wrangler. LabShelf apps never deploy or update them.

## Identity

- A user's identity is the verified email of their Cloudflare account. Every call that names a caller sends the user's Cloudflare access token as a bearer token.
- The directory calls `GET https://api.cloudflare.com/client/v4/user` once with the token, takes `result.email` and discards the token. The token is never logged, stored or forwarded. `/user` has no verified flag, so the email of an account that answers `/user` counts as verified; a token `/user` refuses (no User Details Read scope, expired, revoked) or an answer without an email is refused `unauthorized`.
- Register and unregister act on the caller's own row. A sender on `lookup` and `send` authenticates the same way: the directory resolves the token to the sender's email and requires that the sender has a registered row; otherwise it answers `unauthorized`.

## Row

One D1 row per registered user:

| Field | Value |
|---|---|
| `emailKey` | HMAC-SHA-256(`DIRECTORY_SECRET`, lowercased email), base64url. Primary key. |
| `inboxUrl` | The base URL of the user's inbox on their relay Worker. |
| `inboxToken` | The token that lets the directory post to that inbox. |
| `encryptionKey` | The user's P-256 encryption public key, raw uncompressed, base64url. |
| `signingKey` | The user's P-256 signing public key, raw uncompressed, base64url. |
| `updatedAt` | Epoch ms of the last register. |

- The raw email is never stored; a lookup lowercases the given email and computes its key.
- A user's fingerprint is the first 16 bytes of SHA-256(`encryptionKey` raw || `signingKey` raw), base64url, as in [collaboration](collaboration.md#identity).

## Endpoints

UTF-8 JSON bodies over `POST`, except the token proxy, which takes a form body. Every route answers the CORS preflight (`OPTIONS`). Errors are JSON `{error: <code>}` with one of `unauthorized`, `not_found`, `rate_limited`, `too_large`, `bad_request`, `unavailable`. A client reads an unknown code as a refusal and offers the invite link.

- `POST /api/directory/register`: bearer access token; body `{inboxUrl, inboxToken, encryptionKey, signingKey}`. Creates or replaces the caller's row and sets `updatedAt`. Answers `{ok: true}`.
- `POST /api/directory/unregister`: bearer access token; empty body. Deletes the caller's row. Answers `{ok: true}`, also when no row existed.
- `POST /api/directory/lookup`: bearer access token of a registered sender; body `{email}`. Answers the recipient's public keys `{encryptionKey, signingKey, fingerprint}`, which the sender needs to seal the invite. Nothing else of the row is returned.
- `POST /api/directory/send`: bearer access token of a registered sender; body `{email, sealed}`, where `sealed` is the invite already sealed to the recipient's keys. The directory looks up the recipient and forwards the sealed invite to their inbox ([Forward](#forward)). Answers `{ok: true}` once the inbox accepted it; an inbox that refuses or cannot be reached answers `unavailable`.

- `POST /api/directory/self`: bearer access token; empty body. Answers `{relayUrl}`, the row's `inboxUrl` (the relay serves its inbox at the root) for the token's own email, so another device of the same user finds their relay. It never answers `inboxToken` or the keys. A token `/user` refuses answers `unauthorized`; an email with no row answers `not_found`.
- `POST /api/oauth/token`: the app's OAuth code exchange, proxied because the Cloudflare token endpoint sends no `Access-Control-Allow-Origin`, so a browser cannot call it directly. The form body is at most 8 KiB (`too_large` past it). `grant_type=authorization_code`, `client_id=6bf60d8231e753c5249c7044aa0c4aff`, `redirect_uri=https://labshelf.org/open/`, `code` and `code_verifier` must each appear exactly once, else `bad_request`. Only those five fields are forwarded to `https://dash.cloudflare.com/oauth2/token`; the answer is that endpoint's status and JSON with `Cache-Control: no-store` and CORS. A failed fetch or a non-JSON answer is `unavailable`. The proxy holds no secret and logs nothing.

TRAP: an unregistered email and an unknown one both answer `not_found` on `lookup` and `send`, so the directory reveals nothing about who uses LabShelf. The app shows only "No LabShelf invitations for this email; copy the invite link instead".

## Forward

- `send` POSTs to `<inboxUrl>/inbox`, authorised with the recipient's `inboxToken`, the JSON body `{sealed, from, ts, sig}`: `from` is the sender's fingerprint, `ts` the epoch ms of signing.
- `sig` is ECDSA P-256 with SHA-256, P1363 encoding, base64url, over the UTF-8 string `labshelf-directory-forward-v1\n<recipient fingerprint>\n<SHA-256 of the canonical JSON of sealed, base64url>\n<ts>`. Canonical JSON is `canonicalJson` of core (keys sorted, no whitespace), UTF-8; the 16 KiB cap is measured on the same bytes.
- The deployed directory public key (raw uncompressed P-256, base64url) is `BMmUprgH9ehXtuPRb-e5VmBOSqUfecllJZQRTBs1joI3LCnUMoI5wWlr_1V8_rQN879xBSyRksHciDGokUCd0hQ`.
- The inbox verifies `sig` with the directory public key built into the relay Worker, checks the recipient fingerprint is its own and refuses a `ts` older than 10 minutes. The sender's identity inside the invite is proven by the sealed invite itself, not by `from`.

## Limits

Counters live in D1, keyed by day or hour, and rows for past periods are pruned. Any limit answers `rate_limited` except the global caps.

- A sealed invite is at most 16 KiB, matching the inbox; a larger one is refused `too_large`.
- `register`: at most 10 per hour per `emailKey`.
- `lookup`: at most 30 per hour per sender.
- `self`: at most 30 per hour and 100 per day per caller, counted before the row lookup and shared with no other route.
- `send`: at most 20 per day per sender, at most 3 per day per (sender, recipient) and at most 10 per day per recipient from all senders.
- Global: at most 50,000 directory requests and 50,000 D1 writes per day. Past either cap every call answers `unavailable` until the day rolls over, so the free plan is never exceeded.

## Never returned or stored

- The inbox token is stored but never returned by any endpoint, `self` included; only the directory uses it, to forward.
- The inbox URL is returned only to the row's own owner, as `relayUrl` on `self`; `lookup` and `send` never return it.
- The raw email is never stored or returned; only its keyed hash is kept.
- The Cloudflare access token is never stored, logged or forwarded.
- The token proxy stores and logs nothing: not the authorization code, the PKCE verifier or the tokens Cloudflare answers.

## Deploy

By hand, once, by the owner of the LabShelf Cloudflare account, from `website/` in a checkout (wrangler is not a repo dependency; `npx` fetches it). The D1 database is `labshelf-directory`, bound as `DB`; migrations live in `website/migrations/`.

1. Sign in to the LabShelf account and create the database, which prints its `database_id`:
   ```sh
   cd website
   npx wrangler login
   npx wrangler d1 create labshelf-directory
   ```
2. Paste the printed `database_id` into `website/wrangler.jsonc` (`d1_databases[0].database_id`, replacing the zero placeholder) and commit it; it is not a secret.
3. Create the tables:
   ```sh
   npx wrangler d1 migrations apply labshelf-directory --remote
   ```
4. Set `DIRECTORY_SECRET` to 32 random bytes. Changing it later orphans every row, and users register again.
   ```sh
   openssl rand -base64 32 | npx wrangler secret put DIRECTORY_SECRET
   ```
5. Generate the signing key, set it as `DIRECTORY_SIGNING_KEY` (PKCS#8 PEM) and print its public key, raw uncompressed base64url, which is the directory public key built into the relay Worker. Keep `directory-signing.pem` offline and delete it from the checkout.
   ```sh
   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | openssl pkcs8 -topk8 -nocrypt -out directory-signing.pem
   npx wrangler secret put DIRECTORY_SIGNING_KEY < directory-signing.pem
   openssl pkey -in directory-signing.pem -pubout -outform DER | tail -c 65 | base64 | tr '+/' '-_' | tr -d '=\n'; echo
   ```
6. Deploy. `build.command` in `wrangler.jsonc` runs `pnpm run build` first, so `dist/` (the share page, the demos and pdf.js, not committed) is always published; it needs `pnpm install` in the checkout.
   ```sh
   npx wrangler deploy
   ```
7. Smoke check, and open question (g) of the spike (D1 binds on the free plan, and only `/api/*` runs the Worker first). The first curl prints `{"error":"unauthorized"} 401` (Cloudflare's `/user` refuses the fake token); the D1 query shows today's `usage` row the curl wrote; the `self` and `oauth/token` curls print `401` and `400`; the next three print `200`, `200` and `404` (static pages serve, migrations are not published). With `wrangler tail` open, loading `https://labshelf.org/` in a browser logs nothing, while the first curl logs one POST.
   ```sh
   curl -s -w ' %{http_code}\n' -X POST https://labshelf.org/api/directory/lookup -H 'authorization: Bearer not-a-token' -d '{"email":"a@b.c"}'
   curl -s -w ' %{http_code}\n' -X POST https://labshelf.org/api/directory/self -H 'authorization: Bearer not-a-token'
   curl -s -w ' %{http_code}\n' -X POST https://labshelf.org/api/oauth/token -d 'grant_type=authorization_code'
   npx wrangler d1 execute labshelf-directory --remote --command "SELECT day, requests, writes FROM usage"
   curl -s -o /dev/null -w '%{http_code}\n' https://labshelf.org/
   curl -s -o /dev/null -w '%{http_code}\n' https://labshelf.org/connected/
   curl -s -o /dev/null -w '%{http_code}\n' https://labshelf.org/migrations/0001_directory.sql
   npx wrangler tail labshelf-website
   ```

- `{"error":"unavailable"}` with 503 on the first curl means D1 is not bound or not migrated; a static-page 404 for `/api/directory/lookup` means `run_worker_first` is missing.
- Later schema changes are new files `website/migrations/000N_*.sql`, applied with the same `migrations apply` before `wrangler deploy`.
- Rotating `DIRECTORY_SIGNING_KEY` needs a relay Worker build with the new public key first; inboxes refuse forwards they cannot verify.
