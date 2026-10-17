# Plan: Folder sync — a library is a folder

Status: approved
Size: 5 sessions — one deletion sweep, then core folder rules, first run, the bridge host, the browser side

## 1. Goal

LabShelf stops talking to Google Drive. A library is a folder on disk; the user puts it inside whatever sync tool they already use (Dropbox, Google Drive for desktop, OneDrive, iCloud Drive, Nextcloud, Syncthing, rclone…), and that tool syncs it. The apps handle what such tools do to a folder (files changing underneath, conflict copies), help the user pick a synced folder on first run, and the browser extension reaches the same folder through a local Native Messaging bridge started by the browser.

## 2. Decisions

- [ ] **D1** LabShelf calls no cloud API for sync. Syncing, sharing big folders and group work are the user's sync tool's job. — free at any scale, works with every cloud, no OAuth verification or quota.
- [ ] **D2** Delete all Drive API sync outright, in every package, with its settings, commands, OAuth sign-in, build-time client injection, tests and docs. No `migrations/`, no guided migration. — the app is unpublished and nobody has Drive-synced data (confirmed by the user, 2026-10-17).
- [ ] **D3** `sha256Hex` survives (used by the AI indexer, community templates and the browser file system): it moves to `packages/core/src/hash/`. Everything else under `packages/core/src/sync/` dies.
- [ ] **D4** Device-local state leaves the library folder, because sync tools would copy and conflict it: the search index (`index.sqlite`), logs, OpenAlex cache, staging and the external-project registry (`projects.json`, absolute paths) move to per-device locations keyed by library root. `.research/sync/` disappears. The synced part of `.research/` is the per-paper sidecars only. Contract: `documents/contracts/library-format.md`.
- [ ] **D5** Conflict copies made by sync tools are detected by name per tool (verified names in `research/sync-tool-files.md`, written in session 2). Sidecar (`data.json`) conflicts merge automatically: union of annotations by id, newer copy of each id wins, then the conflict copy is deleted; a deleted annotation may come back, none is ever lost. Conflicts on `metadata.yaml`, PDFs and other files are surfaced for the user to choose (keep mine / keep the other / keep both). — user choice, 2026-10-17.
- [ ] **D6** `documents/contracts/sync.md` is rewritten as the folder-sync contract: which files are synced, which are device-local, how conflict copies are handled, how apps tolerate partial writes. Present tense, no history.
- [ ] **D7** First run (VS Code and terminal): detect sync folders, suggest `<sync folder>/LabShelf`, offer "only on this computer" (`~/LabShelf`) and "choose a folder"; picking a folder that already holds a library opens it ("Found your library with N papers"). A "How to sync between computers" guide is a core DOM component. The apps keep watching for a sync folder to appear and offer to move the library into it. Moving the library is a core node operation with tests (data-loss path).
- [ ] **D8** The bridge: a Native Messaging host program `labshelf-bridge` whose protocol is runtime-neutral core code (`packages/core/src/bridge/`) and whose host runs in Node (`packages/core/src/bridge/node/`). VS Code ("LabShelf: Connect the Browser") and the terminal (`labshelf bridge install`) register it for Chrome, Chromium, Brave and Firefox, with a launcher that runs the host on the Node that installed it. Contract: new `documents/contracts/bridge.md`.
- [ ] **D9** The browser uses one source at a time: the folder through the bridge when the bridge answers, otherwise its own IndexedDB library with a warning that uninstalling the extension deletes it, plus "Save to a folder on this computer". When the bridge first connects and the in-browser library has papers, the browser offers to move them into the folder and then empties IndexedDB. Captures go straight into the folder.
- [ ] **D10** Out of scope, in later plans: several libraries open at once (personal plus a shared lab folder); share links (Drive or Cloudflare); live collaboration (P2P/Yjs); a mobile app.
- [ ] **D11** Other plans: delete `browser-sync-drive-check` and session 6 of `writing-project-templates` (the Drive `templates` namespace); rewrite only the Drive premises of `writing-2-writing-sync`, `writing-3-writing-browser-bridge` and `writing-4-browser-editor` to the folder model. — user choice, 2026-10-17.

## 3. Acceptance

- [ ] **A1** No file in `packages/` or `scripts/` references Google Drive, OAuth or `__LABSHELF_GOOGLE_CLIENT_ID__`; `pnpm -r typecheck` and `pnpm -r test` pass.
- [ ] **A2** The VS Code command palette, settings, the terminal help and the browser popup/options show nothing about Drive or sync intervals.
- [ ] **A3** A library whose folder another tool rewrites (papers added, metadata changed, a half-written file) refreshes in VS Code and the terminal without losing papers.
- [ ] **A4** A Dropbox, Syncthing, Nextcloud, OneDrive, iCloud or Google Drive conflict copy of `data.json` is merged and removed; one of `metadata.yaml` is shown to the user with keep mine / keep other / keep both, and nothing is deleted without the user's choice.
- [ ] **A5** Device-local files no longer live inside the library folder.
- [ ] **A6** First run in VS Code offers detected sync folders; choosing a folder that already holds a library opens it; "Move Library…" moves it and the other apps follow through the shared config.
- [ ] **A7** After "Connect the Browser" in VS Code, the browser extension lists the same papers as VS Code, and a paper captured in the browser appears in VS Code without a reload.
- [ ] **A8** Without the bridge, the browser library works and shows the uninstall warning; connecting the bridge offers to move its papers into the folder.

## 4. Sessions

| Session | File | Deliverable | Owns | Runs with |
|---|---|---|---|---|
| 1 | [sessions/1-delete-api-sync.md](sessions/1-delete-api-sync.md) | Drive API sync gone everywhere; other plans reconciled | `packages/*/src/**/sync*`, app composition roots, manifests, `scripts/googleCredentials.mjs`, `documents/**` | alone |
| 2 | [sessions/2-folder-rules.md](sessions/2-folder-rules.md) | device-local state out of the library, conflict copies, robust watchers, sync contract | `packages/core/src/library/**`, `packages/core/src/hash/**`, app watchers, `documents/contracts/{sync,library-format}.md` | alone |
| 3 | [sessions/3-first-run.md](sessions/3-first-run.md) | first run, sync guide, move library, conflict UI | `packages/core/src/library/node/location/**`, `packages/core/src/ui/dom/syncGuide/**`, VS Code and terminal library setup | alone |
| 4 | [sessions/4-bridge-host.md](sessions/4-bridge-host.md) | bridge protocol, host and installers | `packages/core/src/bridge/**`, VS Code and terminal bridge commands, `documents/contracts/bridge.md` | alone |
| 5 | [sessions/5-browser-bridge.md](sessions/5-browser-bridge.md) | browser on the folder through the bridge | `packages/browser/**` | alone |
