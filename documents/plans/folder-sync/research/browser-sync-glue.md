sha: 3159f508
files: packages/browser/src/**, packages/browser/manifest.*.json, packages/browser/__tests__/**
source: Explore scout, 2026-10-17

# Browser Drive-sync glue

Delete whole: `src/sync/**` (browserSync.ts, auth/{browserDriveAuth,tokenStore,index}.ts; token key `labshelf.gdrive.token`); `src/background/{alarmSyncTimers,syncOnIdle,autoSyncScheduler,syncMessages}.ts`; `src/storage/idbManifestFileSystem.ts` (+ `storage/index.ts:3`); `src/options/driveConnection.ts`; `src/popup/syncButton.ts`; `src/library-page/statusBar/syncStatus.ts`.

Edit:
- `background/index.ts:3-5,22-48` (auth, timers, sync, syncMessages, `installAutoSyncScheduler`, `installIdleSyncTrigger`, `installBadgeUpdater(syncMessages.snapshot, sync.onStatus)`; `onSynced` does `rebuildFromFiles()` + `broadcastChanged("sync")`).
- `background/badgeUpdater.ts`: likely sync-only; check the PDF-offer badge first.
- `background/router.ts:~29,55-75` (`isSyncMessage`, `handleSyncMessage`, deps `syncMessages`, `scheduleSync`).
- `scheduleSync` call sites: `background/handlers/{capture,library,access,askAuthor,citationMap}.ts`, `background/pdfOffer/offerHandlers.ts:17-71`, `library-page/host/runtimeRequests.ts` (`scheduleSyncSoon`), `library-page/host/handlers/{paperHandlers,folderHandlers,pdfHandlers:42}.ts`.
- `platform/runtimeMessages.ts:7-12` (auth.*, sync.* messages); `:153` `reason: "sync"` in `library.changed` (keep the broadcast, drop the member).
- `platform/settings.ts:14-15,34` + `options/generalForm.ts:49,56` (`autoSyncMinutes`); `options/index.ts:9,73,77,94`; `popup/index.ts:10,33-35,56`, `popup/index.html:18` (`#sync`); `library-page/main.ts:14,37-38`, `statusBar/{statusBar,index}.ts`.
- Copy and comments saying "sync": `popup/saveFlow.ts:137,166`, `reader/index.ts:68,145`, `capture/watch/accessTab.ts` (unchecked), `storage/paperRecordStore.ts:37`, `storage/{idb/schema.ts:2,25,pdfStaging.ts:4,idbFileTree.ts:12,indexedDbFileSystem.ts:3,80,idbSidecarPort.ts:2,libraryMutations.ts:50,folderTreeStore.ts:3}`.
- IDB store `manifest` (`storage/idb/schema.ts` `ManifestRow`, created `storage/idb/upgrade.ts:17`): bump version, delete store; test `__tests__/storage/upgradeDb.test.ts`.
- Manifests (chrome/firefox): permissions `identity`, `alarms`, `idle` (grep `bx.alarms`/`bx.idle` first: `background/draftCache.ts`, `pdfOffer/offerStore.ts`, `capture/watch/accessWatches.ts`, `content/scholar.ts` matched); host permissions `https://www.googleapis.com/*`, `https://oauth2.googleapis.com/*`; `description` line 5.
- Build: `build/build.mjs:6` imports `scripts/googleCredentials.mjs`.

Tests: delete `__tests__/sync/**`, `__tests__/background/alarmSyncTimers.test.ts`, maybe `badgeUpdater.test.ts`; update handler tests (`scheduleSync` arg), `__tests__/platform/settings.test.ts`.

Storage facts for session 5: DB `labshelf` (`storage/idb/db.ts`), stores `files` (path, bytes, mtime, hash), `metadata` (PaperRecord cache). PDFs at `<paper path>/paper.pdf`; sidecars at `appdata/<paperId>/data.json` (INVARIANT `idbSidecarPort.ts:2`: appdata maps to `.research/papers`). Port `LocalFileSystem` (`core/src/ports/localFileSystem.ts:16-26`) implemented by `IndexedDbFileSystem`; `SidecarPort` by `createIdbSidecarPort(fs)`; `IPaperRecordIndex` by `storage/libraryMutations.ts:41-45`. `new IndexedDbFileSystem()` is built ad hoc at `storage/libraryMutations.ts:84`, `capture/attachPdfToPaper.ts:25`, `background/handlers/{citationMap.ts:17,libraryRef.ts:13}`, `library-page/host/handlers/{pdfHandlers.ts:100,paperFileHandlers.ts:73}`, `library-page/host/snapshots/sidecarReads.ts:20`, `reader/index.ts:26`. Capture writes: `capture/captureService.ts:128-181` → `mutations.importPaper` (`libraryMutations.ts:88`); attach: `capture/attachPdfToPaper.ts:15`. No `connectNative`/`nativeMessaging` exists.
