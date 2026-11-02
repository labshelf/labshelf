# Contract: directory

Read when you change the LabShelf directory that delivers first-contact invites by email, a client that talks to it, its limits or how it is deployed.

The directory lets a user invite someone by email when the two have never exchanged an invite link. It maps a keyed email to the recipient's inbox and public keys, and forwards a sealed invite to that inbox for the sender. It runs on the Cloudflare free plan (Workers Free and D1 free) and never leaves it: when a limit refuses, the app falls back to the invite link and says so. Clients call it only when the user acts; they never poll.

## Hosting

- The directory runs in the `labshelf-website` Worker with a D1 database. `assets.run_worker_first` is `["/api/*"]`, so only `/api/*` reaches the Worker code; every other path is a static asset.
- Worker secrets: `DIRECTORY_SECRET` (the HMAC key for email keys) and the directory's ECDSA P-256 private signing key. The matching public key is built into the [relay Worker](relay.md), which checks every forward ([Forward](#forward)).
- The Worker and the D1 database are deployed by hand with wrangler. LabShelf apps never deploy or update them.

## Identity

- A user's identity is the verified email of their Cloudflare account. Every call that names a caller sends the user's Cloudflare access token as a bearer token.
- The directory calls `GET https://api.cloudflare.com/client/v4/user` once with the token, takes the verified email and discards the token. The token is never logged, stored or forwarded. A token without the User Details Read scope, or an account whose email is not verified, is refused `unauthorized`.
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

UTF-8 JSON bodies over `POST`. Errors are JSON `{error: <code>}` with one of `unauthorized`, `not_found`, `rate_limited`, `too_large`, `bad_request`, `unavailable`. A client reads an unknown code as a refusal and offers the invite link.

- `POST /api/directory/register`: bearer access token; body `{inboxUrl, inboxToken, encryptionKey, signingKey}`. Creates or replaces the caller's row and sets `updatedAt`. Answers `{ok: true}`.
- `POST /api/directory/unregister`: bearer access token; empty body. Deletes the caller's row. Answers `{ok: true}`, also when no row existed.
- `POST /api/directory/lookup`: bearer access token of a registered sender; body `{email}`. Answers the recipient's public keys `{encryptionKey, signingKey, fingerprint}`, which the sender needs to seal the invite. Nothing else of the row is returned.
- `POST /api/directory/send`: bearer access token of a registered sender; body `{email, sealed}`, where `sealed` is the invite already sealed to the recipient's keys. The directory looks up the recipient and forwards the sealed invite to their inbox ([Forward](#forward)). Answers `{ok: true}` once the inbox accepted it; an inbox that refuses or cannot be reached answers `unavailable`.

TRAP: an unregistered email and an unknown one both answer `not_found` on `lookup` and `send`, so the directory reveals nothing about who uses LabShelf. The app shows only "No LabShelf invitations for this email; copy the invite link instead".

## Forward

- `send` POSTs to `<inboxUrl>/inbox`, authorised with the recipient's `inboxToken`, the JSON body `{sealed, from, ts, sig}`: `from` is the sender's fingerprint, `ts` the epoch ms of signing.
- `sig` is ECDSA P-256 with SHA-256, P1363 encoding, base64url, over the UTF-8 string `labshelf-directory-forward-v1\n<recipient fingerprint>\n<SHA-256 of sealed, base64url>\n<ts>`.
- The inbox verifies `sig` with the directory public key built into the relay Worker, checks the recipient fingerprint is its own and refuses a `ts` older than 10 minutes. The sender's identity inside the invite is proven by the sealed invite itself, not by `from`.

## Limits

Counters live in D1, keyed by day or hour, and rows for past periods are pruned. Any limit answers `rate_limited` except the global caps.

- A sealed invite is at most 16 KiB, matching the inbox; a larger one is refused `too_large`.
- `register`: at most 10 per hour per `emailKey`.
- `lookup`: at most 30 per hour per sender.
- `send`: at most 20 per day per sender, and at most 3 per day per (sender, recipient).
- Global: at most 50,000 directory requests and 50,000 D1 writes per day. Past either cap every call answers `unavailable` until the day rolls over, so the free plan is never exceeded.

## Never returned or stored

- The inbox URL and inbox token are stored but never returned by any endpoint; only the directory uses them, to forward.
- The raw email is never stored or returned; only its keyed hash is kept.
- The Cloudflare access token is never stored, logged or forwarded.
