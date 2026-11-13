# Contract: remote library

Read when you change the Mirror Durable Object, the sync that fills it from VS Code or the browser, the edits applied back to the home folder, the storage limits, the Remote access switch, or the page at `labshelf.org/open/` that reads and edits it.

The remote library is a copy of the owner's library that the owner opens, and edits, from any browser at `labshelf.org/open/`. Their LabShelf copies the library into a Mirror Durable Object that the owner's [relay Worker](relay.md#contract-relay) binds; the page signs in with the owner's Cloudflare account, reads the Mirror and sends its edits back to it, and the owner's apps apply those edits to the home folder. Workers and clients update separately, so both sides follow every rule here and the [relay versions](relay.md#versions).

## Store

- One SQLite-backed `Mirror` Durable Object per owner holds the remote library. It lives in the **share Worker**, which a relay rotation never replaces (migration tag `v1` of `SHARE_MIGRATIONS` with `new_sqlite_classes`, [Deploy](relay.md#deploy)); the relay binds it as `MIRROR` with `script_name` set to the share Worker, so a rotation keeps every row and `/open/` and the directory do not change. It is not the share Worker's KV. The relay's own migration `v4` deletes the class `Mirror` that relays before this change held.
- A row is keyed by its library-relative [row path](#row-paths) and holds `{hash, size, kind, updated}` beside its value; `kind` is `papers`, `notes`, `source`, `deck`, `space`, `home`, `output`, `asset` or `pdf`, `hash` is the SHA-256 hex of the value's bytes (a string is UTF-8 encoded) and `updated` is epoch ms.
- A value is stored in the store the owner chose ([Storage and limits](#storage-and-limits)): in `do`, SQLite chunks of 7 MiB (`CHUNK_BYTES`) returned whole, so a reader never sees the chunks; in `r2`, one R2 object per row at `<generation>/<path>`, with no chunk rows.
- The Mirror also holds its settings (`generation`, `store`, limit, `includePdfs`, the R2 operations counter), the pending [edits](#edits), the owner email, the [writer lease](#writer-lease) and the hourly [session](#page-session) counter.
- The `generation` is 16 random bytes, base64url, drawn when the Mirror is first used and again by every clear (`DELETE /mirror/rows`) and every store change. Clients key their state by it.

## Content

- Mirrored: the paper index (one entry per paper with its metadata record and folder, plus the folder tree); each paper's `notes.qmd`; each project's text sources (`.tex`, `.typ`, `.bib`, `.qmd`, `.sty`, `.cls`, `.bst`, `.bbx`, `.cbx`, `.csv`, `.txt`, `.md`, `.json`, project notes) and its root `labshelf.yaml`; each project's image assets (`.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.eps`) and its PDFs that are not compiled outputs; each deck as its single-file HTML from `exportDeckHtml`; each Space's `space.json`, `glossary.json`, `notes/*.qmd`, `discussions/*.qmd` and `notes/assets/*.csv`; the root `home.json`; compiled project outputs; and, only when [Include paper PDFs](#storage-and-limits) is on, the PDFs directly in a kept paper's folder.
- A compiled output is a `.pdf` under `projects/` beside a `.tex` or `.typ` of the same basename.
- A file is at most 64 MiB, whatever its kind (decks, outputs, assets, paper PDFs too). A larger file, a deck that fails validation, or an unreadable file is skipped and reported to the owner.
- Skipped: trashed papers, `.labshelf-conflict-*` copies, hidden folders and build output (`build`, `_output`).
- Text kinds (`papers`, `notes`, `source`, `deck`, `space`, `home`) are strings; `output`, `asset` and `pdf` are bytes.

## Row paths

Row paths are library-relative and joined with `/`. They are the Mirror's keys. In a URL each segment is percent-encoded, so `/mirror/file/` and `/mirror/edit/` take the path with its `/` kept.

| Path | Kind | Value |
|---|---|---|
| `index/papers.json` | `papers` | the [paper index](#paper-index) and folder tree |
| `papers/<folder>/<id>/notes.qmd`, or `papers/<id>/notes.qmd` at the root | `notes` | the paper's notes |
| `papers/<folder>/<id>/<name>.pdf`, the PDF directly in a kept paper's folder | `pdf` | the paper's PDF bytes, only with Include paper PDFs |
| `projects/<project>/<file>` for the text extensions above and project notes | `source` | the file's text |
| `projects/<project>/<file>` for the image extensions and PDFs that are not outputs | `asset` | the file's bytes |
| `projects/<project>/<deck folder>/deck.html`, the deck's own `deck.html` path | `deck` | the deck's single-file HTML from `exportDeckHtml` |
| `projects/<project>/labshelf.yaml` | `source` | the project settings (title, format, main file) |
| `spaces/<id>/space.json`, `glossary.json`, `notes/<name>.qmd`, `discussions/<name>.qmd`, `notes/assets/<name>.csv` | `space` | the file's text |
| `home.json` | `home` | Home's text |
| the compiled PDF's own library path (`projects/thesis/main.pdf`) | `output` | the PDF's bytes, one row |

A row an [edit](#edits) creates gets its kind from its path (`mirrorKindOfPath`): `home.json` is `home`, `spaces/` is `space`, `papers/` is `notes`, anything else `source`; an edit of an existing row keeps that row's kind.

## Paper index

`index/papers.json` is `{"version": 1, "folders": string[], "papers": [{"id": string, "folder": string, "record": PaperRecord}]}`.

- `folder` is the paper's folder path under `papers/` joined with `/`, `""` at the root.
- `folders` lists every folder path, sorted, without `""`.
- `record` is the paper's metadata record as `LibrarySnapshot` holds it (title, authors, year, tags, status). The index is read-only on the page: a paper's status, tags and details change on the computer.

## Sync run

- A run takes the [writer lease](#writer-lease), reads `GET /mirror/status`, [applies the edits](#edits) the page made, reads the selected files, hashes each and compares it with the device's table (VS Code keeps it in `mirror.json`, see [library-format.md](library-format.md#device-local-files); the browser in its own store). The table is `{version: 2, generation, rows}`, keyed by the Mirror's `generation`, so a relay rotation does not re-upload; a different generation (a cleared Mirror, a store change) starts an empty table.
- The selection takes `includePdfs` from the status. Only changed rows are sent, then the rows whose files disappeared are deleted. The table is written after every accepted request, so a failed request keeps what was already accepted.
- A row travels as text in a `POST /mirror/rows` JSON batch of at most 8 MiB when it is text of at most 1 MiB; every other row (bytes, or text over 1 MiB) goes alone through `PUT /mirror/file/<path>`.
- A run sends at most 400 changed rows. When more changed, the run is partial: it sends the first 400, withholds deletions, and the next run resumes from the table. A relay failure or a lost lease also ends the run partial.
- The run plans the [storage](#storage-and-limits) budget before sending: a file whose upload would pass the limit is left out, listed in `leftOut`, and the rest goes on. Left-out files do not hold back deletions; a `full` refusal does (it stops the run, which is partial and marked full).
- The result carries `storage: {store, used, limit, warn, full, leftOut}`, which the Account tab shows.
- A run that cannot take the lease is skipped and sends nothing.
- VS Code runs on start and 30 seconds after the last external-change batch; the browser runs at boot, when the page becomes visible and on `library.changed`. Each host runs one at a time; a change during a run schedules one more run after it. While Remote access is on, each host also pulls the edits every 60 seconds, in the same queue as the sync runs.

## Edits

- The page sends every save as `PUT /mirror/edit/<path>` (or `DELETE`) with `x-labshelf-base`, the hash of the row as the page loaded it (`""` for a new file). The Mirror writes the row at once, computes its SHA-256, and records a pending edit `{path, base, hash, deleted, at}` that keeps the earliest unacked `base` and the latest `hash`; a delete has `deleted` 1 and hash `""`.
- The Mirror answers `409 conflict` with the row's current hash when that hash differs from `base` (a missing row has hash `""`). On a conflict on a text file the page reads the current row, merges it with its refused edit against the text it last read or saved (qmd item by item, other text line by line) and sends the merged text again with the 409's hash as base, at most three sends in all; an open file whose text the merge changed shows the merged text. An overlapping change of the same lines, a refused byte edit or a refused delete keeps the user's text and shows "This file changed elsewhere. Reload to see the latest version."
- The page keeps per text file the hash and text it last read or saved, and sends that hash as `x-labshelf-base` (not the hash a later index read saw), so an edit of a row changed since is refused and merged rather than written over it. Open files are re-checked against the index on focus, visibility and every 30 s; a newer row is read and shown unless a write to the file is waiting, whose send merges.
- The page coalesces writes to one path within 1 second into one request, the last winning, and sends the waiting ones when it is hidden. A write of text equal to what the page holds sends nothing.
- A host applies edits with `applyMirrorEdits` at the start of every sync run and on the 60-second timer: `GET /mirror/edits`, and for each edit it compares the local file's hash (a missing file is `""`) with the edit's `base`:
  - equal to `base`: the new bytes (`GET /mirror/file/<path>` with the owner secret) are written atomically, creating parent folders, or the file is deleted;
  - equal to the edit's `hash`: nothing to write;
  - otherwise a conflict: the web version is written beside the file as a conflict copy named by `conflictCopyPath` (`<file>.labshelf-conflict-<id>`), the local file is kept and the next sync uploads it over the Mirror's row.
- After each applied or conflicted edit the device table records the row as the Mirror holds it (applied: the edit's hash; conflict: left so the next diff re-uploads the local file) and the edit is acked with `POST /mirror/edits/ack`, which deletes it only when its hash still matches. When the edit list is empty a pull is one cheap request.
- On the device a failed edit (the file cannot be written) pauses uploads for that run, so a local file is not sent over an edit not yet applied.
- Not editable from the page: the paper index and paper metadata, and the trash, rename and removal of Spaces and folders, which the page refuses.

## Storage and limits

- `used` is the sum of the rows' sizes. The owner chooses where values live, in the Account tab:

| Store | Cost | Default limit | Notes |
|---|---|---|---|
| `do` (Durable Object) | free, no card | 5 000 000 000 bytes, also the most a `do` limit may be | Cloudflare's free SQLite storage of the account |
| `r2` | 10 GB free, then billed; needs a card on the Cloudflare account | 9 000 000 000 bytes | one object per row |

- A put that would make `used - oldSize + newSize` pass the limit is refused `full` with `reason: "storage"`; so is a SQLite write that throws because the account's Durable Object storage is full. In `r2` every put and list counts one Class A operation in the UTC month (`ops_month`, `YYYY-MM`), and a put when the count is at or over 900 000 is refused `full` with `reason: "operations"` (the free tier is 1M).
- `warn` is true at 90% of the limit. The limit is the Mirror's setting, changed with `PUT /mirror/settings`; a `do` limit over 5 GB is refused `malformed`. The owner raises or lowers it and the app respects it.
- Include paper PDFs (`includePdfs`, off by default) is a Mirror setting too; the Account tab shows the space the PDFs would use before it is turned on.
- Changing `store` clears the rows, chunks, R2 objects and pending edits of the Mirror and draws a new generation, keeping the owner email; the next sync uploads into the new store. `r2` is refused `noBucket` (409) while the share Worker has no `MIRROR_BUCKET` binding.
- R2 setup is by hand: the owner creates a bucket named `labshelf-mirror` in the Cloudflare dashboard (the OAuth client cannot request an R2 scope), then Move to R2 redeploys the share Worker with the bucket binding (`bindMirrorBucket`; `RelayAccount.shareWorker.r2Bucket` is kept so every later upload re-sends it). A missing bucket is shown as "Create the R2 bucket labshelf-mirror first (R2 needs a card on your Cloudflare account)." Move to Durable Object clears the Mirror and unbinds the bucket.
- The account-wide Durable Object usage is approximated by the Mirror's own rows.

## Security

- Access is protected by the owner's Cloudflare login, like Google Drive.
- The Mirror stores plaintext inside the owner's own Cloudflare account; Cloudflare encrypts it at rest. Anyone who signs in to that Cloudflare account can read and, from the page, write it.
- LabShelf recommends that the owner turn on Cloudflare two-factor authentication.
- A session is minted only for the stored owner email, so it authorizes only the owner's page to read and to edit.

## Routes

All on the owner's relay Worker, JSON with `v` like the other [relay endpoints](relay.md#endpoints), answered to any origin with `OPTIONS`. Owner routes take the owner secret as bearer; page routes take a [session token](#page-session) as `Authorization: Bearer <session>`.

| Route | Auth | Request | Answer |
|---|---|---|---|
| `PUT /mirror/owner` | owner secret | `{email}` | `{v}` |
| `POST /mirror/lease` | owner secret | `{deviceId, action}`, action `acquire`, `renew` or `release` | `{v, held}` |
| `POST /mirror/rows` | owner secret | `{put: [{path, kind, hash, size, value}], delete: [path]}`, body at most 8 MiB | `{v}` |
| `PUT /mirror/file/<path>` | owner secret | the raw bytes, headers `x-labshelf-kind` and `x-labshelf-hash`, body at most 64 MiB | `{v}` |
| `DELETE /mirror/rows` | owner secret | none | `{v}`; clears the rows, chunks, R2 objects of the generation, edits and the owner email, and draws a new generation |
| `GET /mirror/status` | owner secret | none | `{v, generation, store, used, limit, includePdfs, rows, edits, r2: {bound, month, operations}}` |
| `PUT /mirror/settings` | owner secret | `{limit?: number \| null, includePdfs?: boolean, store?: "do" \| "r2"}` | the status answer |
| `GET /mirror/edits` | owner secret | none | `{v, edits: [{path, base, hash, deleted, at}]}` |
| `POST /mirror/edits/ack` | owner secret | `{edits: [{path, hash}]}` | `{v}` |
| `POST /mirror/session` | none | `{accessToken}` | `{v, session, expires}`, or `{v, error}` |
| `GET /mirror/index` | session | none | `{v, rows: [{path, kind, hash, size, updated}]}` |
| `GET /mirror/file/<path>` | session or owner secret | none | the row's value, whole, as bytes |
| `PUT /mirror/edit/<path>` | session | the raw bytes, header `x-labshelf-base`, body at most 64 MiB | `{v, hash}`, or `409 {v, error: "conflict", hash}` |
| `DELETE /mirror/edit/<path>` | session | header `x-labshelf-base` | `{v}`, or the same conflict |

- Size limits: a `POST /mirror/rows` body over 8 MiB, and a file or edit body over 64 MiB, is refused `tooLarge` (413), checked on `Content-Length` before the body is read and again on the bytes read. A sync keeps its batches under 8 MiB.
- `POST /mirror/session` errors: `off` (no owner email is stored, 403), `other_account` (the stored owner email differs from the Cloudflare account's, 403), `unauthorized` (Cloudflare rejects the access token, 401) and `rateLimited` (the hourly counter is spent, 429).
- A page route without a valid, unexpired session, or an owner route without the owner secret, is refused `unauthorized` (401). `GET /mirror/file/<path>` for a path with no row is refused `notFound` (404).
- Other refusals: `conflict` (409, an edit whose base is stale), `full` (507, with `reason` `storage` or `operations`), `noBucket` (409, `store: "r2"` with no bucket bound) and `malformed` (an unreadable body or path, a `do` limit over 5 GB).
- `expires` and the session's expiry are epoch milliseconds.

## Page session

- The page at `labshelf.org/open/` signs in with Cloudflare (Authorization Code with PKCE, scope `user-details.read`, no refresh token), finds the owner's relay through the directory and sends the access token once, to `POST /mirror/session`.
- The Worker calls `GET https://api.cloudflare.com/client/v4/user` with it and compares the answer's email, case-insensitively, with the stored owner email. It then discards the token: never stored, never logged.
- A Worker with no owner email answers `off`, so a different Cloudflare account and a switched-off library both see no data. Only a stored owner email that differs answers `other_account`.
- On a match it answers a session token, valid 4 hours, and `expires`. The token is `<expMs>.<HMAC>`: `expMs` is the expiry in epoch milliseconds and the HMAC (base64url) is over `expMs`, keyed from the owner secret with the purpose `mirror-session`. The Worker keeps no session; it recomputes the HMAC on each read and each edit.
- The page keeps the Cloudflare token and the session token in memory only and writes nothing to storage. Sign out drops them, closes every open view and clears the page's session storage.
- A Worker answers at most 60 session requests per hour. Every `POST /mirror/session` counts, before the Cloudflare call, whatever its outcome; the counter is per hour and lives in the Mirror. The 61st request of an hour is refused `rateLimited` (429).
- The page runs the heavy runtimes only on demand and from CDNs, pinned by version or hash: Typst's compiler (wasm and fonts from jsDelivr and typst-assets, checked with SHA-256, because the 28 MB wasm is over the website's 25 MiB asset limit), Pyodide 314.0.7 (jsDelivr) and WebR 0.6.1 (`webr.r-wasm.org`). Python and R cells show "Runs in your browser: a reduced version, slower, with fewer libraries and no access to your computer's packages or files." and other languages "<Language> cells run only on your computer."; saved outputs always display. LaTeX compiles with pdflatex through texlyre-busytex 1.4.1 (TeX Live 2026, AGPL-3.0), under the experimental notice: its wrapper loads as a chunk on the first compile, and its engine and TeX Live packages (texlive-basic preloaded, texlive-recommended on demand, biber) come from the `labshelf-assets` R2 bucket, served same-origin by the website Worker at `/busytex/<version>/<file>` with an immutable year-long cache (`website/src/directory/busytexAssets.ts`; uploaded by `website/tools/uploadBusytex.mjs`, which writes the hashes to `website/src/open/runtimes/busytexManifest.ts`). One engine per page; an abort stops it. Its log reads through core's `parseTexLog`, and a missing `.sty` or `.cls` says "The LaTeX package <file> is not available in the browser engine."

## Writer lease

- One device writes at a time, so VS Code and the browser never interleave a sync.
- A sync first sends `POST /mirror/lease` with `action: acquire` and its device id; `held` is true when this device now holds the lease. A device that is not the holder skips the sync.
- The holder sends `renew` while its sync runs and `release` when it ends. A lease expires 10 minutes after its last acquire or renew, so a device that stops mid-sync does not block the others. The lease covers the device's sync and edit pulls; the page's edits take no lease, the base hash settles them.

## Switch

- Remote access is off by default. Its switch lives in the Account tab both apps open, below the Cloudflare section.
- The switch works only with Cloudflare connected by sign-in: the owner email is read from `GET /client/v4/user` with the sign-in's access token. A pasted API token has no user-details access, so the switch answers "Remote access needs Cloudflare sign-in" and stays off. With no Cloudflare connection the switch is disabled and says "Connect Cloudflare first".
- Turning it on stores the owner's Cloudflare email (`PUT /mirror/owner`), registers the relay in the directory when it is missing, runs the first sync and keeps the on flag. The flag is stored per library, on the device that turned it on.
- Turning it off sends `DELETE /mirror/rows`, which deletes every row, the pending edits and the owner email, so the page answers `off`, and removes the device's table. The flag is kept only after the change succeeded; a failure shows its message under the switch.

## Account tab

- The Cloudflare section reads "Connected as <email>, with your relay at <host>" (the email comes from `GET /client/v4/user` with the sign-in token); a pasted token has no email and reads "Connected, with your relay at <host>".
- With the switch on, the Remote access section shows: where the files are stored ("Durable Object, free" or "R2"); "<used> of <limit> used"; at 90% "Your remote library is almost full"; when full, for `do` "Your 5 GB are full. To store more, move to R2 (needs a card on your Cloudflare account)." and for `r2` "Your limit of <limit> is reached. Raise it to keep sending.", each with the list of what was left out; a limit field in GB with Save; the switch Include paper PDFs, which first asks "Paper PDFs will use about <size>. Include them?" with Include and Cancel; and Move to R2 or Move to Durable Object.
- Move to R2 first says "Create an R2 bucket named labshelf-mirror in your Cloudflare dashboard (R2 needs a card on file), then choose Move to R2.", then binds the bucket and moves the store; a Cloudflare refusal is shown under the control. Any move clears the Mirror, and the next sync uploads into the new store.
- The figures come from the host's last sync result and `GET /mirror/status`; they are empty before the first run and absent when the switch is off or the relay is unreachable.
