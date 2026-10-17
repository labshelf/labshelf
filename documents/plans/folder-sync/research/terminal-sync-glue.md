sha: 3159f508
files: packages/terminal/src/**, packages/terminal/package.json, packages/terminal/__tests__/**
source: Explore scout, 2026-10-17

# Terminal Drive-sync glue

Delete whole:
- `src/sync/**`: driveAccount.ts, terminalAuth.ts, terminalSync.ts (builds core SyncCoordinator), tokenStore.ts (keychain/secret-tool/`credentials.json`, env `LABSHELF_TOKEN_STORE`), index.ts.
- `src/cli/syncCommands.ts` (`labshelf sync`, `labshelf auth login|logout|status`; find its dispatch in `cli/index.ts` / `args.ts`).
- `src/ui/app/actions/driveSync.ts` (export `actions/index.ts:6`).

Edit:
- `cli/usage.ts:28-30` help; `cli/doctor.ts:5,9,34-40` (drive client check, `readSyncRunRecord`, `layout.lockPath/lastRunPath`).
- `ui/app/actions/commandLine.ts:8,17,44-47` (`:sync`/`:s`, `:login`, `:logout`).
- `ui/app/app.ts:13` (`reportSync`), `:70` (`ctx.sync.onStatus`), `:87-91` (`startPeriodic`, `periodicTick`), `:96-97` (quit waits for sync).
- `ui/keymap.ts:12` (`"sync"` action), `:111` (`S` "Sync with Google Drive now"), `:113` help text.
- `ui/app/drawing/status.ts:4,64,70-79` (`syncSegment`); `ui/theme.ts:92` (`sync` style).
- `app/context.ts:6-7,17,28-29,48-54` (`openSync`), `:84` (`onLocalChange: () => sync.scheduleLocalChange()`; remove the hook if nothing else needs it), `:100` (`sync.refreshLastRun()` in `startWatcher`), `:120-121,138,148-149,156` (`sync.stop()`).
- `app/config.ts:27-28` (`autoSyncMinutes`); `main.ts:45` ("and Drive sync"), `main.ts:78` (prints `layout.manifestPath()`).
- `package.json:5` description mentions Google Drive sync.
- Unverified "sync" hits: `cli/openCommand.ts`, `paperService.ts`, `library/sidecars.ts` (probably `onLocalChange` or the word).

Tests: delete `__tests__/sync/{tokenStore,terminalSync,driveAccount}.test.ts`, `__tests__/cli/syncCommands.test.ts`, `__tests__/fixtures/{syncDevice,fakeRemote}.ts`. Update `__tests__/cli/doctor.test.ts`, `__tests__/fixtures/cliSession.ts` (sets `LABSHELF_GOOGLE_CLIENT_ID` and a fake `credentials.json` at L11,79,99,119), `__tests__/app/context.test.ts`, `__tests__/ui/app/{app,drawing/status,actions/commandLine}.test.ts`, `__tests__/ui/overlays.test.ts`, `__tests__/fixtures/appHarness.ts`.

Stays: `src/library/libraryWatcher.ts` (recursive `fs.watch` on papers and sidecars, 250 ms debounce, 5 s polling fallback, TUI only; does not watch `projects/`).
