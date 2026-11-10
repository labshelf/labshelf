# Request: remote library, simple mode

Written for the agent that writes this plan's YAML files and for the sessions that run it. Decisions below were made with the user on 2026-11-09.

## Goal

On a computer that is not theirs, the user opens `https://labshelf.org/open/`, clicks Connect to my LabShelf, signs in with Cloudflare, and browses their library read-only: paper metadata (title, authors, folders, tags, status), paper notes, the text sources of their writing projects (`.tex`, `.typ`, `.bib`, `.qmd`), and their decks (open and Present). Nothing is installed and nothing stays on that computer.

## Scope

- Relay Worker (core): a new Mirror Durable Object and routes.
- Core: a mirror runner that keeps the Mirror up to date from the library.
- VS Code and browser extension: the Remote access switch in the Account tab (already shown, disabled, with "Coming soon"), and the triggers that run the mirror.
- Account tab back end (session 7): the core Account port gains remote access; VS Code's user name is a mock today (kept in global state, unused by collab); it becomes the name collab uses.
- Website: the `/open/` page, an OAuth token proxy, and a directory endpoint that returns the caller's own relay URL.

## Non-goals (simple mode)

- PDFs: never mirrored, never downloadable. R2 storage is a later, optional mode.
- Editing of any kind; the page is read-only.
- Depending on a home computer being on.
- Spaces, annotations (`data.json`), kits, `home.json`, external project folders, versions, built PDFs.
- The terminal app.

## Decisions

- D1 Store: a SQLite-backed `Mirror` Durable Object in the owner's relay Worker (migration tag v3, `new_sqlite_classes`), not share Worker KV (KV free allows about 1,000 writes per day). Rows are keyed by library-relative path with `{hash, size, kind, updated}`; a value over the 2 MB row limit is split into chunks.
- D2 Content: the paper index (one row per paper with its metadata record and folder; folder tree), `notes.qmd` per paper, project text sources (`.tex .typ .bib .qmd`, project notes), and each deck as its single-file HTML from `exportDeckHtml` (at most 20 MiB per deck; a deck that fails validation is skipped and reported). Skipped: trashed papers, `.labshelf-conflict-*` copies, hidden folders, build output, everything in Non-goals.
- D3 Security model, accepted by the user: access is protected by the owner's Cloudflare login, like Google Drive. The Mirror stores plaintext inside the owner's own account (Cloudflare encrypts at rest). Anyone who signs in to the owner's Cloudflare account can read it. The docs say so plainly and recommend Cloudflare two-factor.
- D4 Owner email: when Remote access is turned on, the app reads `GET /client/v4/user` with its OAuth token and sends the email to the Mirror with the owner secret (`PUT /mirror/owner`). A pasted API token without user-details access shows "Remote access needs Cloudflare sign-in" and stays off.
- D5 Page session: the page sends its Cloudflare access token once to `POST /mirror/session`. The Worker calls `/user`, compares the email case-insensitively with the stored owner email, discards the token, and answers a session token (HMAC with `OWNER_SECRET`, 4 hours). Reads (`GET /mirror/index`, `GET /mirror/file/<path>`) need it. Rate-limited per Worker.
- D6 Finding the Worker: a new directory endpoint `POST /api/directory/self` (bearer Cloudflare token) answers the caller's own relay URL, never the inbox token, rate-limited. Turning on Remote access registers the directory row when it is missing. The directory contract's "never returned" rule changes for the row's own owner.
- D7 OAuth on the page: Authorization Code + PKCE with the existing client id, scope `user-details.read` only (no `offline_access`, so no refresh token). The redirect `https://labshelf.org/open/` must be added to the Cloudflare OAuth client by hand before the hand check (session 6). The token endpoint sends no CORS header, so the website Worker always proxies the code exchange at `POST /api/oauth/token` (it holds no secret). The PKCE verifier and state live in `sessionStorage` only during the redirect and are deleted on return; the token lives in memory only.
- D8 One writer: the Mirror holds a writer lease (device id, renewed while a sync runs, expires after 10 minutes), so VS Code and the browser never interleave a sync. A device that is not the lease holder skips.
- D9 Change detection: VS Code runs the mirror after the external-change batch (debounced 30 s) and on start; the browser runs it on page visible and `library.changed`. Each run lists the selected files, hashes them, diffs against a device-local hash table (VS Code: `state/<library key>/mirror.json`; browser: `storage.local`), and uploads only changed rows in batched requests, then deletes rows that disappeared. The table records the relay URL and resets when it changes (rotation, reconnect).
- D10 Budget: the free plan's 100,000 daily Worker requests are shared with the relay's abuse rotation. A sync uses batches (many rows per request, under 1 MiB per request) and stops after a per-run cap, resuming next run.
- D11 Page: `website/open/` and `website/src/open.ts`, following the share page: `mountLibraryUi` with `readOnly: true` and in-memory prefs; notes with `mountQmdEditor({readOnly: true})`, loaded lazily; sources in a read-only CodeMirror (as `deckSourceView.ts`), loaded lazily; decks in `mountDeckShareViewer` (sandbox `allow-scripts` only). No Download PDF anywhere. A Sign out button clears memory and reminds the user to sign out of Cloudflare or to use a private window.
- D12 Switch: Remote access is off by default. It lives in the Account tab both apps already open (`packages/core/src/account/`, view in `account/dom/accountView.ts`), below the Cloudflare section; no separate command or options row. Turning it off deletes the Mirror's rows.
- D14 Account port: `AccountState` gains `remoteAccess: { available: boolean; on: boolean; busy: boolean; message?: string }` and `AccountPort` gains `setRemoteAccess(on)`, carried by a new `account.setRemoteAccess` message. `AccountHost` gains an optional `remoteAccess()` the app supplies; when it is missing, or Cloudflare is not connected, the switch stays disabled with the reason. The view drops "Coming soon", shows the switch's state, disables it while a run is busy and shows `message` (for example "Remote access needs Cloudflare sign-in").
- D15 VS Code user name: the Account tab's name (global state key `labshelf.account.userName`, today marked `// MOCK:`) becomes the name collab uses: `userName()` in `packages/vscode/src/collab/node/register.ts` reads the saved name and falls back to the OS user name. New share connections, presence, comments and suggestions use it; presence takes a getter so a rename applies without a reload. Authors already written keep their old name. The browser already uses the real member name.
- D13 Deck export reading (`deck.html`, `theme.css`, assets) is duplicated in `packages/vscode/src/share/node/host.ts:88-102` and `packages/browser/src/libraryUi/host/browserShareHost.ts:93-103`; it moves to one core helper used by share and mirror.

- D16 index and row format: index/papers.json is {"version": 1, "folders": string[], "papers": [{"id": string, "folder": string, "record": PaperRecord}]}; folder is the paper's folder path under papers/ joined with "/" ("" at the root); folders lists every folder path, sorted, "" excluded; record is the paper's metadata record as LibrarySnapshot holds it (title, authors, year, tags, status). Row paths are library-relative with "/": index/papers.json (kind papers); papers/<folder>/<id>/notes.qmd, or papers/<id>/notes.qmd at the root (kind notes); projects/<project>/<file> (kind source); projects/<project>/<deck folder>/deck.html (kind deck, value the single-file HTML).

## Sessions

1. Contracts and Worker: new `documents/contracts/remote-library.md`; `relay.md` (version, endpoints, auth, deploy: three DOs). Mirror DO, routes (`/mirror/owner`, `/mirror/lease`, `/mirror/rows` batch put/delete, `/mirror/session`, `/mirror/index`, `/mirror/file/<path>`), migration v3, binding, protocol minor bump. Contract level.
2. Directory and OAuth: `/api/directory/self`, the `/api/oauth/token` proxy, `directory.md`; core OAuth helpers take a redirect and scopes. Contract level. Can run beside session 1.
3. Core mirror runner: file selection, hash table port, diff, batched upload, lease, rotation reset; the D13 core deck helper. Depends on 1.
4. App wiring: owner email and directory registration, the switch in the Account tab of VS Code and the browser, triggers. Depends on 2, 3 and 7.
5. `/open/` page. Depends on 1 and 2.
6. Docs (`product.md`, `ui.md`: the Account tab, its switch); the user registers the `/open/` OAuth redirect by hand, then the hand check of the acceptance below.
7. Account tab back end: the core Account port's remote access (D14) and VS Code's saved user name as the collab name (D15). No dependency; can run now.

## Acceptance (checked by hand in session 6)

- A1 With Remote access on, editing a paper's notes in VS Code shows the new text on `/open/` within about a minute of the next sync.
- A2 On another browser profile, `/open/` asks for Cloudflare sign-in, then lists the papers with folders, tags and status, and no PDF button.
- A3 A project's `.tex` file opens read-only with highlighting; a talk opens and Present goes full screen.
- A4 Signing in with a different Cloudflare account shows "This LabShelf belongs to another Cloudflare account" and nothing else.
- A5 After Sign out or closing the tab, reopening `/open/` asks for sign-in again, and the browser's storage for labshelf.org holds no library data.
- A6 Turning Remote access off makes `/open/` show "Remote access is off" after sign-in.
- A7 A relay rotation followed by the next sync makes `/open/` show the library again.
- A8 In the Account tab of VS Code and of the browser, the Remote access switch is enabled only with Cloudflare connected; turning it on shows it on after the first sync, and a pasted API token shows "Remote access needs Cloudflare sign-in".
- A9 Saving a user name in VS Code's Account tab makes a collaborator see that name on the next cursor move and on new comments.
