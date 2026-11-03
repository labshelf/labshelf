# Spike: email-invites assumptions on real free Cloudflare accounts

Run 2026-11-02 on two free accounts (A, B) signed in the way LabShelf signs in: OAuth Authorization Code + PKCE with the LabShelf client, loopback redirect 127.0.0.1:8976, in a private browser window. Scratch Workers were named `ls-spike-*` and deleted afterwards. No token or account id is recorded here.

Scopes granted: `workers-scripts.admin workers-kv-storage.write account-settings.read user-details.read account-analytics.read offline_access`.

| Q | Question | Verdict | Evidence |
|---|---|---|---|
| a | Can `user:read` be added to the LabShelf OAuth client, and does `GET /client/v4/user` return the verified email? | **Yes, with `user-details.read`.** The email is returned; the response has no "verified" field. | The scope id is `user-details.read` (`GET /client/v4/oauth/scopes`). Without it `/user` answers 9109 Unauthorized; with it, `/user` answers success with `email` on A and B. `account-analytics.read` had to be added to the client separately (`invalid_scope` until then). |
| b | Do requests to a deleted Worker or a disabled workers.dev route count against the account's 100k? | **No.** | 10 calls before deleting `ls-spike-deleted`, 200 calls after: all 200 answered 404 from the edge. Analytics for the account then showed 19 requests in total for the window, which matches the calls made to live scratch Workers only; the total was still 19 on a second reading over an hour later. |
| c | Do certificate transparency logs show script names or only the subdomain? | **Neither appears.** | crt.sh has no certificate for `%.<A's subdomain>.workers.dev` and none naming `ls-spike`; workers.dev hosts are served under Cloudflare's own certificates, not per-script ones. |
| d | Is the Rate Limiting binding available on Workers Free? | **Yes.** | Upload with a `ratelimit` binding (limit 3 / 60 s) succeeded; 6 calls gave allowed ×4, limited ×2 (the limit is approximate, per edge location). |
| e | Can the OAuth token read Worker request counts on the free plan, and with which scope? | **Yes, with `account-analytics.read`.** | GraphQL `viewer.accounts.workersInvocationsAdaptive` (sum of requests, errors by scriptName) answered for account A. Deleted scripts show as `__unknown__`. |
| f | Does an update with a new migration tag add a SQLite DO class to a live Worker without losing Room data? | **Yes.** | v1 with `Room` (tag v1, `new_sqlite_classes`) stored a row; v2 added `Inbox` with `old_tag: v1, new_tag: v2`; Room still returned the row and Inbox answered. |
| g | Does D1 bind to the labshelf-website Worker on the free plan with `run_worker_first` limited to `/api/*`? | **Yes.** | Measured at session 6's deploy on the LabShelf account: `wrangler deploy` bound `env.DB` (labshelf-directory); `POST /api/directory/lookup` with a bad token answered 401 from the Worker; `/` answered 200 and `/migrations/0001_directory.sql` 404 from static assets. |

## Consequences for the plan

- `CLOUDFLARE_SCOPES` in `packages/core/src/relay/relayOAuth.ts` gains `user-details.read` and `account-analytics.read`. A user's consent page lists both; sign-in stays one approval.
- D13 is final: the earlier analytics signal is used (see plan.yaml D13); error 1027 stays the backstop.
- D12 holds: a rotated-away, deleted relay costs nothing.
- For the directory (session 6): `/user` gives the account email but no verified flag. The plan takes the email of an account that signed in and deployed a relay as verified (an assumption, not measured here: Cloudflare asks new accounts to verify their email); the directory still refuses a token whose `/user` call fails.
