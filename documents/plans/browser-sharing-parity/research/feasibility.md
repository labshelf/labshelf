sha: 0a58f09
files: packages/core/src/relay/oauth/*, packages/browser/manifest.*.json, packages/core/src/collab/node/*, packages/browser/src/storage/*, packages/browser/src/collab/*
source: Session 1 proofs (2026-10-20): live Cloudflare endpoints, Chromium 1194 with an unpacked scratch extension

# Technical gates

The browser session uses the first invite relay and creates in-memory docs. The Node session uses a persistent store, relay selector/watch, blob exchange and bidirectional mirror. The browser writer persists texts/comments, skips blobs and does not implement the Node reconciliation rules. Browser library access uses IndexedDB, picked-folder and bridge adapters; reuse them instead of extending the helper into a second collaboration implementation.

## OAuth route (D7) — chosen: loopback redirect observed from the library page

Cloudflare accepts only the registered loopback redirect `http://127.0.0.1:8976/callback` for client `6bf60d82…`. An extension identity redirect is refused, so `chrome.identity.launchWebAuthFlow` would need a registration change by the client owner; it is not used.

The library page that starts sign-in opens the consent URL with `tabs.create` and watches that tab with `tabs.onUpdated`. When the tab's URL starts with the registered redirect, the page reads it with the core `readAuthorizationCode` (state checked first), closes the tab and exchanges the code with the core token client. Nothing needs to listen on port 8976: the failed navigation still exposes the URL. The existing `http://*/*` and `https://*/*` host permissions give the page the tab URL and a CORS-free `fetch` to the token endpoint, so no manifest permission is added.

- Lifetime: the listener lives in the library page, not the MV3 worker, so worker suspension does not drop it. Closing the page cancels sign-in. Timeout 10 minutes, the same as VS Code. The consent tab is closed on success, error, timeout and cancel.
- A running VS Code loopback on 8976 may receive the redirect first; its state check rejects it, and the page's own listener still sees the URL. Neither side ever sees the other's verifier.
- Only the tab the page opened is watched (tab id match); a redirect in any other tab is ignored.

Evidence (sanitized, rerunnable with `node research/proof/run.mjs research/proof` from the plan directory: a page calls `tabs.create` on a local URL that 302s to the redirect):

| Check | Result |
|---|---|
| `GET /oauth2/auth` with the registered redirect, S256 challenge, the four scopes | 302 to the Cloudflare login (accepted) |
| same with `https://<id>.chromiumapp.org/` | 302 to `/oauth/error`: redirect_uri does not match any pre-registered redirect |
| Chromium: page sees `http://127.0.0.1:8976/callback?code=…&state=…` in `tabs.onUpdated` for its tab | passed |
| Chromium: page `fetch` POST to `/oauth2/token` (no CORS allow-origin on the server) | readable 400 `invalid_grant` JSON, so exchange and refresh errors reach the core client |

Unresolved gates (session 9, real run):
- Firefox is not installed in this environment. The same mechanism relies on `tabs.onUpdated` exposing a URL covered by a granted host permission (Firefox 127+ grants MV3 host permissions at install; the manifest requires 128). Not marked passed.
- A real account sign-in, token exchange and refresh rotation have not run. They need a Cloudflare account during session 9.

## Mirror ownership (D6) — two layers

### Browser tabs: Web Locks

An exclusive `navigator.locks` lock named `labshelf:collab:<library id>:<share id>` decides which tab of this browser profile runs a share's session and mirror. Extension pages share an origin, so every library page sees the same locks.

| Check (Chromium, two extension pages) | Result |
|---|---|
| second page `ifAvailable` on a held name | `busy` |
| same share id under another library id | granted: separate libraries are independent peers |
| owner page closed | next request granted (owner death releases the lock) |
| third page with `steal: true` | granted; the previous holder's request rejects with `AbortError`, which is how it learns it lost ownership |

Contention shows the non-owner tab read-only with a "Use here" action; that action steals. The losing tab stops its mirror, keeps its editor buffers and pending text, and becomes an observer. It never writes to disk after the steal rejection.

### Same physical folder across apps: in-folder lease file

A browser-only lock cannot see VS Code, and a picked folder exposes no path, so the lease lives where every root can reach it: `<project>/.labshelf/mirror-lease.json`, written through the root's own file port (Node fs, bridge, picked folder). It is keyed by the folder, not the share, so different local copies of one share still connect at the same time. `.labshelf/` is already never shared.

```json
{ "owner": "<random id per running mirror>", "app": "vscode" | "browser", "renewedAt": 1792509862000, "ttlMs": 30000 }
```

- Acquire: read; a foreign lease with `renewedAt + ttlMs` in the future is contention. Otherwise write our lease, wait 1.5 s, read again; still ours means owned. A malformed file counts as expired and is replaced, with a WARN log.
- Renew every 10 s. Before each renewal and before each disk write batch, read the lease; a foreign owner means the lease was lost: stop writing to disk, keep the session connected and the editor buffers, and report it.
- Owner death (crash, killed page, closed VS Code): the lease expires after 30 s and the next acquirer takes it. A clean close deletes the file only if it is still ours.
- Handoff: a deliberate "Use here" writes our lease over an unexpired foreign one; the old owner sees it at its next check (at most 10 s, and before any further write batch).
- Residual race: read-then-write is not atomic on any of these ports. The confirmation read after 1.5 s makes a double acquire need two writers inside that window; the loser then yields at its first check. Accepted and documented in the contract.
- A folder synced to another device carries the lease too; the rule is the same (one mirror per folder content), and sync delay can make a lease look stale there. Documented as a limit, not solved.
- `templates.md` must exclude `.labshelf/mirror-lease.json` from saved templates, together with the contract change.

IndexedDB libraries have no physical folder: only the Web Lock applies.

## Library identity (D5)

State keys use `<library id>/<share id>`:
- IndexedDB: `browser`.
- Bridge: `bridge:<first 16 hex of SHA-256 of the root the helper reports>`.
- Picked folder: a random id stored with the folder handle in the picked-folder store when the folder is picked; picking the same folder again (`isSameEntry`) keeps it.

Stored invites from the current `collabShares` record carry no library; the migration assigns them to the library whose project list holds that share id, and leaves unmatched entries in place for the next library that does.

## Storage/browser combinations

| Source | Chrome | Firefox |
|---|---|---|
| IndexedDB | Web Lock only | Web Lock only |
| Picked folder | Web Lock + lease file | not available (no directory picker) |
| Bridge | Web Lock + lease file via the helper's file operations | Web Lock + lease file via the helper's file operations |

No helper change is needed: the lease file is an ordinary read/write/delete through the existing bridge file operations.
