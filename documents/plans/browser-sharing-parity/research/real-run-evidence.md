# Real-run evidence: sharing parity (session 9, partial)

- sha: 7225dba
- source: a Linux cloud container run of Chromium 141, VS Code 1.142.0 (test-electron), Firefox 158.0.1 (geckodriver) and wrangler 4.151.3 local relays (`wrangler dev --local`, https). Recipes: [browser.md](../../../apps/browser.md#collaboration-against-a-local-relay), [vscode.md](../../../apps/vscode.md#collaboration-against-a-local-relay).
- date: 2026-10-20

The container has no Cloudflare access (the dashboard is blocked by the proxy, no credentials, no user present). Every real-Cloudflare item is NOT VERIFIED: sign-in, deploy, token expiry and refresh rotation, Worker update, fresh-socket refusal, a second real relay, resource ownership and costs.

## Results

| Id | Environment | Harness | Observed content | Result |
|---|---|---|---|---|
| A1 browser to browser | Chromium, two profiles, local relay | CDP/Playwright scripts, IndexedDB reads | Share gives `labshelf://join#v1.<share>.<key>.<relays>`, the yaml gains `shared:`, the joiner's `main.tex` is byte-identical, wss opens for both, both resume after restart. A cancelled confirm leaves no yaml change, share entry or collab database. Copy Invite Link toasts. | PASS |
| A1 leave | Chromium | same | The member menu offers Copy Invite Link, Share Details, Stop Sharing on This Device. Leave keeps files, removes share state and leaves the owner unaffected: not run. | NOT VERIFIED (script stopped before the click) |
| A1 VS Code to browser | VS Code host, Chromium joiner | runner extension, CDP, IndexedDB reads | Share gives `/claim 200` and a socket upgrade; the browser join stores `main.tex` equal to the disk file. Browser edit reaches the VS Code disk within 20 s; a disk edit reaches the browser editor. | PASS |
| A1 browser to VS Code | VS Code joiner | - | not run | NOT VERIFIED |
| A2 browser to browser | Chromium | same | Text converges both ways within 4 s. Ctrl+Z in B removes only B's edit. A comment with a reply shows in B's Comments tab, editor range and stored `comments.json`. Peer carets show; their name label is not visible and both users are "Guest". | PASS (name labels unconfirmed) |
| A2 cross-app comment, history restore | VS Code and browser | - | not run | NOT VERIFIED |
| A3 | any | - | Blob add/rename/delete and shared settings: not run | NOT VERIFIED |
| A4 offline edit, reload | Chromium, relay stopped | scripts reading `labshelf-collab` | Offline keystrokes persist as `updates` rows; editor, `files` and decoded Yjs text agree after reload and after SIGKILL plus relaunch. | PASS |
| A4 catch-up via relay | Chromium, relay up, peer offline | same | Edits from an earlier process were never uploaded: the peer stayed on old text while later live edits piled up as pending rows. Fixed by f1543a5 (the device holds a Yjs snapshot per relay and document). | FAIL, fixed; NOT re-run |
| A4 short relay outage | Chromium | same | After three failed tickets the single relay is marked down for one hour and no ticket is requested after it returns. Matches [collaboration.md](../../../contracts/collaboration.md#relay-list). | FAIL (design question) |
| A4 failed persistence write | Chromium | - | not run | NOT VERIFIED |
| A5 second relay failover | any | - | Two local relays prepared in the recipe; not run. | NOT VERIFIED |
| A6 | - | - | not part of this run | NOT VERIFIED |
| A7 two-tab and same-folder lease | any | - | Not run. A headless browser cannot reach a folder without the native helper, so the folder case needs two VS Code hosts on one folder. | NOT VERIFIED |
| A8 | any | - | Paper links on the public page with a real PDF: not run | NOT VERIFIED |
| A9 dialogs, keyboard, narrow width | any | - | Screenshots and Tab/Escape checks: not run. Escape on the share confirm was checked in A1. | NOT VERIFIED |
| A10 Chromium | Chromium | script | The library runs on IndexedDB with no folder; the no-bridge banner shows. A malformed invite and a picked folder: not run. | PARTIAL |
| A10 Firefox | Firefox headless | geckodriver, `moz-extension` page | Manifest lint 0 errors (76 warnings); the add-on installs; the library page renders from IndexedDB; `not-a-valid-invite`, `labshelf://join#garbage` and `#/join/garbage` show "This is not a LabShelf invite link."; the banner shows with no host and keeps content; no `showDirectoryPicker` and no folder button. | PASS |
| A10 Firefox share dialogs, popup, capture | Firefox | - | Share, Import Shared Link and Manage Shared Links dialogs, popup, options and background behaviour: not run. `tabs.onUpdated` seeing the OAuth redirect from a page-opened tab: not run. | NOT VERIFIED |
| A11 gate | container | `pnpm typecheck`, test, build | vscode and browser: typecheck, tests, builds PASS. website: PASS after 00867ca. core: PASS except 4 permission tests that fail only because the container runs as root (they pass as user `nobody`): libraryConflictScan "cannot be written", nodeLibraryFileSystem `listDir` unreadable, installTexLive `install-tl` fails, assertHelperPrivatePaths 0o775. | PASS (root-only failures) |

## Bugs found and fixed on main

- 43ef127: the browser share failed when a project has no `.labshelf/comments.json`, because browser adapters throw a plain `Error` and core expected `ENOENT`.
- 149b13b: a new share whose owner relay refused the claim finished with an invite listing no relays and no error; it rolls back and reports.
- f1543a5: offline edits from an earlier process were not uploaded after reconnect with cursor above 0.
- 00867ca: website typecheck and test regressions.
- 7225dba: relay test settle flake.

## Open observations (unconfirmed)

- The joiner names the project folder and yaml id `project` instead of the owner's id.
- The sidebar menu may stay stale about 1.5 s after sharing (only Share Project is offered until a reload).
- Named cursors show no label when no display name is set; both users read "Guest".
- A single relay that failed three tickets stays down for one hour, so a short outage disconnects the client for an hour. This is a design question for the user.
- A cancelled "Connect Cloudflare" prompt in VS Code still went on to share because the account was stored meanwhile; `shareProject.ts` re-reads the account after `requireRelay`.
