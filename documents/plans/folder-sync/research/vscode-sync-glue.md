sha: 3159f508
files: packages/vscode/src/sync/**, packages/vscode/src/activation/**, packages/vscode/src/extension.ts, packages/vscode/package.json
source: Explore scout, 2026-10-17

# VS Code Drive-sync glue

Delete whole:
- `src/sync/**`: adapter/syncController.ts (status bar item, `sync.autoSyncIntervalMinutes`, connect/disconnect), adapter/syncReport.ts, auth/secretStorageTokenStore.ts (SecretStorage key `labshelf.gdrive.tokens`), auth/openAuthorizationUrl.ts, node/vscodeDriveAuth.ts, index files.
- `src/activation/libraryLifecycle/syncControllerLifecycle.ts` (export at `libraryLifecycle/index.ts:3`).
- `src/activation/registration/registerSyncCommands.ts` (exports `registration/index.ts:6`, `activation/index.ts:9`; called `extension.ts:72`).

Edit:
- `libraryLifecycle/libraryRootController.ts:10,27,41-43,69`: drop the sync lifecycle param and calls; keep `externalChangeHandling.watch(root)`.
- `registration/registerSettingsMenu.ts:11-20`: remove "Sync now", "Disconnect from Google Drive", "Connect to Google Drive"; keep other entries.
- `extension.ts:19-25` imports, `:72`, `:101-112` (`syncLifecycle`, `onSynced`, `libraryChanged(result)`).
- `serviceComposition/hostAdapters.ts:5,23-26` and `node/nodeAdapters.ts:6,11,26-30`: remove `sync: {host, lock, createDriveAuth, listProjects}`.
- `package.json:163-177` commands `labshelf.sync.connect|now|disconnect`; `:815-820` setting `labshelf.sync.autoSyncIntervalMinutes`. `:500` `$(sync)` is an icon of something else — check before touching.

Tests: delete `__tests__/sync/**` (syncControllerLock, auth/openAuthorizationUrl, auth/secretStorageTokenStore, fakes). Update `__tests__/activation/registration/registerSettingsMenu.test.ts`, `__tests__/activation/libraryLifecycle/libraryRootController.test.ts`, `__tests__/activation/node/nodeAdapters.test.ts`.

Unrelated "sync" grep hits: `src/pdf-viewer/ReaderPanel.ts`, many writing tests (the word, not Drive).

Watcher that stays: `src/storage/data/externalChangeWatcher.ts` (FileSystemWatcher on `papers/**` and sidecars, 1 s debounce, `isExternalChangeNoise`), wired in `activation/libraryLifecycle/externalChangeHandling.ts:22` → `services.reindexLibrary()` then refresh.
