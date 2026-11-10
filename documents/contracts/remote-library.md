# Contract: remote library

Read when you change the Mirror Durable Object, the sync that fills it from VS Code or the browser, the Remote access switch, or the page at `labshelf.org/open/` that reads it.

The remote library is a read-only copy of the owner's library that the owner opens from any browser at `labshelf.org/open/`. Their LabShelf copies the library's text into a Mirror Durable Object in their own [relay Worker](relay.md#contract-relay); the page signs in with the owner's Cloudflare account and reads it back. PDFs are never copied. Workers and clients update separately, so both sides follow every rule here and the [relay versions](relay.md#versions).

## Store

- One SQLite-backed `Mirror` Durable Object per relay Worker (binding `MIRROR`, migration tag `v3` with `new_sqlite_classes`, [Deploy](relay.md#deploy)) holds the remote library. It is not the share Worker's KV.
- A row is keyed by its library-relative [row path](#row-paths) and holds `{hash, size, kind, updated}` beside its value; `kind` is `papers`, `notes`, `source` or `deck`, and `updated` is epoch ms.
- A value over the 2 MB row limit is stored in chunks and returned whole, so a reader never sees the chunks.
- The Mirror also holds the owner email, the [writer lease](#writer-lease) and the hourly [session](#page-session) counter.

## Content

- Mirrored: the paper index (one entry per paper with its metadata record and folder, plus the folder tree), each paper's `notes.qmd`, each project's text sources (`.tex`, `.typ`, `.bib`, `.qmd` and project notes), and each deck as its single-file HTML from `exportDeckHtml`.
- A deck is at most 20 MiB. A deck that fails validation is skipped and reported to the owner.
- Skipped: trashed papers, `.labshelf-conflict-*` copies, hidden folders and build output.
- PDFs are never mirrored.

## Row paths

Row paths are library-relative and joined with `/`. They are the Mirror's keys.

| Path | Kind | Value |
|---|---|---|
| `index/papers.json` | `papers` | the [paper index](#paper-index) and folder tree |
| `papers/<folder>/<id>/notes.qmd`, or `papers/<id>/notes.qmd` at the root | `notes` | the paper's notes |
| `projects/<project>/<file>` for `.tex`, `.typ`, `.bib`, `.qmd` and project notes | `source` | the file's text |
| `projects/<project>/<deck folder>/deck.html`, the deck's own `deck.html` path | `deck` | the deck's single-file HTML from `exportDeckHtml` |

## Paper index

`index/papers.json` is `{"version": 1, "folders": string[], "papers": [{"id": string, "folder": string, "record": PaperRecord}]}`.

- `folder` is the paper's folder path under `papers/` joined with `/`, `""` at the root.
- `folders` lists every folder path, sorted, without `""`.
- `record` is the paper's metadata record as `LibrarySnapshot` holds it (title, authors, year, tags, status).

## Sync run

- A run takes the [writer lease](#writer-lease), reads the selected files, hashes each and compares it with the device's hash table (VS Code keeps it in `mirror.json`, see [library-format.md](library-format.md#device-local-files); the browser in its own store). Only changed rows are sent, then the rows whose files disappeared are deleted. The table is written after every accepted request, so a failed request keeps what was already accepted.
- A run sends at most 400 changed rows. When more changed, the run is partial: it sends the first 400, withholds deletions, and the next run resumes from the table. A relay failure or a lost lease also ends the run partial.
- A row whose request would pass 1 MiB (the [route limit](#routes)) is skipped and reported to the owner with the rest of the skipped files; it stays unsent and is reported again by each run until it shrinks.
- A run that cannot take the lease is skipped and sends nothing.
- VS Code runs on start and 30 seconds after the last external-change batch; the browser runs at boot, when the page becomes visible and on `library.changed`. Each host runs one at a time; a change during a run schedules one more run after it.

## Security

- Access is protected by the owner's Cloudflare login, like Google Drive.
- The Mirror stores plaintext inside the owner's own Cloudflare account; Cloudflare encrypts it at rest. Anyone who signs in to that Cloudflare account can read it.
- LabShelf recommends that the owner turn on Cloudflare two-factor authentication.

## Routes

All on the owner's relay Worker, UTF-8 JSON with `v` like the other [relay endpoints](relay.md#endpoints), answered to any origin with `OPTIONS`. Writes take the owner secret as bearer; reads take a [session token](#page-session) as `Authorization: Bearer <session>`.

| Route | Auth | Body | Answer |
|---|---|---|---|
| `PUT /mirror/owner` | owner secret | `{email}` | `{v}` |
| `POST /mirror/lease` | owner secret | `{deviceId, action}`, action `acquire`, `renew` or `release` | `{v, held}` |
| `POST /mirror/rows` | owner secret | `{put: [{path, kind, hash, size, value}], delete: [path]}` | `{v}` |
| `DELETE /mirror/rows` | owner secret | none | `{v}`; clears every row and the owner email |
| `POST /mirror/session` | none | `{accessToken}` | `{v, session, expires}`, or `{v, error}` |
| `GET /mirror/index` | session | none | `{v, rows: [{path, kind, hash, size, updated}]}` |
| `GET /mirror/file/<path>` | session | none | the row's value, whole |

- A `POST /mirror/rows` request stays under 1 MiB; a larger body is refused `tooLarge` (413) before it is parsed. A sync splits its rows across requests.
- `POST /mirror/session` errors: `off` (no owner email is stored, 403), `other_account` (the stored owner email differs from the Cloudflare account's, 403), `unauthorized` (Cloudflare rejects the access token, 401) and `rateLimited` (the hourly counter is spent, 429).
- A read without a valid, unexpired session is refused `unauthorized` (401). `GET /mirror/file/<path>` for a path with no row is refused `notFound` (404).
- `expires` and the session's expiry are epoch milliseconds.

## Page session

- The page at `labshelf.org/open/` signs in with Cloudflare (Authorization Code with PKCE, scope `user-details.read`, no refresh token), finds the owner's relay through the directory and sends the access token once, to `POST /mirror/session`.
- The Worker calls `GET https://api.cloudflare.com/client/v4/user` with it and compares the answer's email, case-insensitively, with the stored owner email. It then discards the token: never stored, never logged.
- A Worker with no owner email answers `off`, so a different Cloudflare account and a switched-off library both see no data. Only a stored owner email that differs answers `other_account`.
- On a match it answers a session token, valid 4 hours, and `expires`. The token is `<expMs>.<HMAC>`: `expMs` is the expiry in epoch milliseconds and the HMAC (base64url) is over `expMs`, keyed from the owner secret with the purpose `mirror-session`. The Worker keeps no session; it recomputes the HMAC on each read.
- The page keeps the Cloudflare token and the session token in memory only and writes nothing to storage. Sign out drops them, closes every open view and clears the page's session storage.
- A Worker answers at most 60 session requests per hour. Every `POST /mirror/session` counts, before the Cloudflare call, whatever its outcome; the counter is per hour and lives in the Mirror. The 61st request of an hour is refused `rateLimited` (429).

## Writer lease

- One device writes at a time, so VS Code and the browser never interleave a sync.
- A sync first sends `POST /mirror/lease` with `action: acquire` and its device id; `held` is true when this device now holds the lease. A device that is not the holder skips the sync.
- The holder sends `renew` while its sync runs and `release` when it ends. A lease expires 10 minutes after its last acquire or renew, so a device that stops mid-sync does not block the others.

## Switch

- Remote access is off by default. Its switch lives in the Account tab both apps open, below the Cloudflare section.
- The switch works only with Cloudflare connected by sign-in: the owner email is read from `GET /client/v4/user` with the sign-in's access token. A pasted API token has no user-details access, so the switch answers "Remote access needs Cloudflare sign-in" and stays off. With no Cloudflare connection the switch is disabled and says "Connect Cloudflare first".
- Turning it on stores the owner's Cloudflare email (`PUT /mirror/owner`), registers the relay in the directory when it is missing, runs the first sync and keeps the on flag. The flag is stored per library, on the device that turned it on.
- Turning it off sends `DELETE /mirror/rows`, which deletes every row and the owner email, so the page answers `off`, and removes the device's hash table. The flag is kept only after the change succeeded; a failure shows its message under the switch.
