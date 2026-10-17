sha: 3159f508
files: packages/core/src/sync/**, packages/core/src/index.ts, packages/core/src/node/index.ts, packages/core/package.json, packages/core/src/library/layout.ts
source: Explore scout, 2026-10-17

# Core sync inventory

`packages/core/src/sync/` is 51 files, 2957 lines: auth/, drive/, provider/, coordinator/, engine/{naming,pipeline,state}/, node/ (PKCE loopback, NodeLockStore, processAlive), status/ (driveStatus*, describeSyncOutcome), util/ (conflictName, contentHash). All of it dies except `sha256Hex`.

Barrels: `core/src/index.ts:7` `export * from "./sync/index.js"`; `core/src/node/index.ts:4` `export * from "../sync/node/index.js"`; `core/package.json:61` export `./test-support/sync-fakes` → `__tests__/support/syncFakes.ts` (also `support/coordinatorHarness.ts`).

Non-sync importers:
- `sha256Hex` (`util/contentHash.ts`): `core/src/ai/indexer/aiIndexer.ts:5`, `core/src/writing/templates/sources/communitySource.ts:5`, `browser/src/storage/indexedDbFileSystem.ts:6,36`; tests `core/__tests__/ai/indexer/aiIndexer.test.ts:4`, `core/__tests__/writing/templates/sources/communitySource.test.ts:3`; `core/__tests__/sync/helpers.test.ts` (or `__tests__/helpers.test.ts`) tests it. Move to `core/src/hash/contentHash.ts`.
- `SyncProject` type: `core/src/writing/project/node/projectSyncList.ts:3,7` (`listSyncProjects`, used only by the vscode and terminal sync adapters). Delete.
- `driveStatusText`, `DriveStatus`: `core/src/ui/dom/settings/driveSection.ts:2` (exported `ui/dom/settings/index.ts:8`). Delete.
- `LockStore` port `core/src/ports/lockStore.ts` is outside sync; delete if unused afterwards.

Layout residue `core/src/library/layout.ts`: `:21` `SYNC_PROVIDER_ID="google-drive"`; `:49-52,63,80-84` `syncDir`, `manifestPath`, `lockPath`, `lastRunPath`; `:96-102` `syncRoots`, `BROWSER_SYNC_ROOTS` (exported `library/index.ts:10-11`); `requiredDirs` creates `.research/sync`. Tests `core/__tests__/library/layout.test.ts:75,85`.

Strings: `core/src/writing/allProjects/dom/projectActions.ts:47,54` "The copy on Google Drive stays"; comment `core/src/library/mutations/import/newPaper.ts:19` "marker that syncs to Drive". `projectsOnlyOnDrive` (`engine/syncTypes.ts:86`) has no UI.

Tests: `core/__tests__/sync/**` (24 files). `CONTRACT:` tags pointing to `sync.md` all live inside `core/src/sync/` and die with it.

Risk: `export *` means a missed symbol shows up as an app typecheck failure — run `pnpm -r typecheck`.
