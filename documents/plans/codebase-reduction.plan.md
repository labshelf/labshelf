# Plan: Codebase reduction

Status: draft
Size: GG — about 2,300 lines across core and all three apps, two contract edits (cite-key scheme, VS Code AI store) and one user-data migration (library root); grows past 6 sessions if S24's adapter fold finds callers that rely on today's divergent semantics
Pending decisions: 0

## 1. Goal

Remove the code the minimal-code ladder (AGENTS.md §3) says should not exist: dead features, copies between apps, hand-written versions of platform APIs, and layers that only forward. Fix the data-loss and silent-failure bugs the audit found first. The product looks and behaves the same, except where §2 says it changes.

## 2. Decisions

- [x] **D1** Bugs first: session 1 fixes the terminal sync data-loss path, the silent swallows and the split trust-boundary checks before any reduction — reductions must not move buggy code around.
- [x] **D2** Delete the unread AI layer: reading events, the AI metadata store, the heuristics that feed only it, the stance detector and the `ai.searchByText` / `ai.searchByClaim` commands. Keep the text indexing the reader needs. Existing `index.sqlite` files keep their dead tables (never synced, never read); no migration. (User, 2026-10-15.)
- [x] **D3** Replace the VS Code settings webview with `viewsWelcome` buttons, the status bar and native settings. The browser options page stays (no native equivalent). (User, 2026-10-15.)
- [x] **D4** Council (LibraryOperations fork): one runtime-neutral core `resolvePaperRefs(ids, lookup)`; each app injects an async lookup, so rescan and no-op-suppression policy stay in the app. The outcome merge stays an inline spread. No shared `LibraryOperations` service — the three apps refresh in three incompatible ways.
- [x] **D5** Batch-outcome and sync-outcome wording moves to core: three reviewers found it already drifted ("Paper removed" vs `Removed "<title>"`). This settles the council's open notice-text clash.
- [x] **D6** Council (cite-key fork): `makeCiteKey` in `library/identity` is the only scheme; `import/pdf/citeKey.ts` is deleted. Local import passes authors only when `fieldSources.authors` scores at XMP level (60) or above; otherwise no authors. "An ugly key is better than a wrong one" — ids never change once written. Existing folders keep their names.
- [x] **D7** The no-author fallback stays `makeCiteKey`'s current form unless S9's measurement on a copy of the user's library shows more than 5 % `claimCiteKey` suffixes among no-author keys; then it uses two title words. This settles the council's open fallback clash with a number.
- [x] **D8** `VscodeFileSystem` stays (F70 rejected): it goes through VS Code's FS layer (remote workspaces) and its rename refuses to overwrite.
- [x] **D9** The library root lives only in the shared config file; a `migrations/` reader copies a globalState-only root once. Its header: delete when no supported VS Code build predates the shared config.
- [x] **D10** The browser page probe (F27) is replaced by core `parseHtmlPage(document.documentElement.outerHTML)` only if the S25 check on a script-rendered publisher page finds the same PDF candidates; otherwise it stays and the finding closes as "keep".
- [x] **D11** VS Code code with no `vscode` import that another app could run (OCR, text layers, what remains of the AI indexer) moves to `core/…/node/` (AGENTS.md §1, question 1).
- [x] **D12** Capture pipeline (F7): core `importLandingPage` splits into a resolve step and a write step; the browser keeps only its inspect/save split and the tab-borrowing fetch.

## 3. Scope

- **In:** every package; `documents/contracts/library-format.md` (cite-key scheme line, VS Code AI store line, shared config as the single root store); the jscpd and knip baselines.
- **Out:** new features; changing existing paper ids or folder names; the browser options page; sync engine behaviour beyond D1.
- **Contracts touched:** `library-format.md` (S6, S10, S16).

## 4. Acceptance criteria

- [ ] **A1** A terminal sync whose local `listDir` fails with EACCES logs the error and deletes nothing remote; a test proves it and fails without the fix.
- [ ] **A2** None of the silent catches listed in S2 remains; each failure is logged through `ILogger` with context.
- [ ] **A3** One `isPdfBytes` and one `isLibraryPath` guard every listed trust boundary; tests cover a rejected input at each.
- [ ] **A4** The AI pieces in D2 are gone from code, `package.json` contributions and docs; the reader still opens, searches text and OCRs a scanned PDF.
- [ ] **A5** One cite-key builder exists. A local import whose authors come only from layout heuristics gets a surname-free key; one with XMP or lookup authors gets `authorYearWord`.
- [ ] **A6** `resolvePaperRefs` lives in core and is used by vscode and terminal; jscpd finds no copy of the id-to-ref loop.
- [ ] **A7** Batch and sync outcome notices read the same in all three apps, from one core module.
- [ ] **A8** VS Code shows the Settings view's welcome buttons; every action the webview offered is reachable by command; the webview code is gone.
- [ ] **A9** An install whose root exists only in globalState opens the same library after the upgrade (test), and the shared config then holds it.
- [ ] **A10** `pnpm knip`, `pnpm lint:deps` and `pnpm jscpd` pass; the jscpd baseline drops below its current value; `packages/*/src` loses at least 1,500 net lines (measured with `git diff --shortstat` from the plan's first commit).
- [ ] **A11** All packages typecheck and test; `verify` passes for the VS Code reader and library, the browser popup and library page, and the terminal frames.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| `resolvePaperRefs(ids, lookup)` | `core/src/library/mutations/` root | `lookup: (id) => Promise<{path, record?} \| undefined>`; returns refs + `"Paper not found"` failures |
| Outcome copy (batch + sync) | `core/src/library-ui/` beside `pdfCopy.ts` | runtime-neutral strings; terminal imports it too |
| `describeSyncOutcome`, `driveStatusOf`, `diskSyncTarget` | `core/src/sync/` | one each; apps only render |
| `renderPagePng` | `core/src/import/node/` | passes `nativeRenderOptions` (fixes the terminal thumbnail) |
| `folderTreeFromSnapshot` | `core/src/library-ui/derive/` | from `snapshot.collections`; vscode tree and browser tree use it |
| Trusted-author gate | local import call site of `makeCiteKey` | one comparison on `fieldSources.authors` |
| Root migration | `packages/vscode/src/storage/migrations/` | header names its deletion condition (D9) |

## 6. Sessions and steps

Every session starts from the previous one committed on a clean tree. Every session ends with `finish` passing and a commit (`commit-splitter`).

### Session 1 — Bugs found by the audit

- **Starts from:** clean tree after commit 14507d1 (ladder audit)
- **Ends with:** A1, A2, A3
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S1 | Terminal sync `listDir` swallows every error | — | H · implementer (opus) | A1 | [ ] |
| S2 | Silent catches → `ILogger` | — | M · implementer (sonnet) | A2 | [ ] |
| S3 | Trust-boundary checks unified; small bugs | — | M · implementer (sonnet) | A3 | [ ] |
| S4 | Finish | S1–S3 | `finish` skill | gate passes | [ ] |

### Session 2 — Delete what nothing reaches

- **Starts from:** session 1 committed
- **Ends with:** A4
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S5 | Map the AI deletion set | — | M · code-mapper (sonnet) | keep/delete list per file | [ ] |
| S6 | Delete the AI layer (F1, F20, F26) | S5 | M · implementer (sonnet) | A4 | [ ] |
| S7 | Rung-1 deletions (F13, F16, F36, F38, F48, F63, F68, F69) | — | M · dead-code-cleaner (sonnet) | gate passes | [ ] |
| S8 | Finish | S5–S7 | `finish` skill | gate passes | [ ] |

### Session 3 — Cross-app copies into core

- **Starts from:** session 2 committed
- **Ends with:** A5, A6, A7
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S9 | Measure no-author keys on a copy of the user's library | — | H · main thread | D7 resolved with a number | [ ] |
| S10 | Council decisions: `resolvePaperRefs`, one cite-key scheme (F17, F33) | S9 | H · implementer (opus) | A5, A6 | [ ] |
| S11 | Shared core pieces (F23, F29, F31, F32, F37, F39, F40, F46, F57, F66) | — | M · implementer (sonnet) ×2 | A7 | [ ] |
| S12 | Browser onto core: Logger, runtime send, drive status (F8, F18, F28) | S11 | M · implementer (sonnet) | gate passes | [ ] |
| S13 | Finish | S9–S12 | `finish` skill | gate passes | [ ] |

### Session 4 — VS Code surface

- **Starts from:** session 3 committed
- **Ends with:** A8, A9
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S14 | Settings webview → `viewsWelcome` (F2) | — | M · implementer (sonnet) | A8 | [ ] |
| S15 | Folder tree from the snapshot, vscode and browser (F3, F45) | — | M · implementer (sonnet) | tree and list match before/after | [ ] |
| S16 | Library root in the shared config only (F24) | — | H · implementer (opus) | A9 | [ ] |
| S17 | VS Code internals (F4, F9, F14, F15, F41) | S14 | M · implementer (sonnet) | gate passes | [ ] |
| S18 | Verify VS Code and browser library | S14–S17 | `verify` skill | screenshots match | [ ] |
| S19 | Finish | S14–S18 | `finish` skill | gate passes | [ ] |

### Session 5 — Core domain, import paths, platform rungs

- **Starts from:** session 4 committed
- **Ends with:** gate passes; F-rows of S20–S22 closed
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S20 | Core-domain reductions (F6, F11, F12, F25, F42, F51, F52, F53) | — | M · implementer (sonnet) | gate passes | [ ] |
| S21 | Import paths (F7, F22, F35, F49, F59, F61) | S20 | H · implementer (opus) | browser capture and terminal import unchanged in verify | [ ] |
| S22 | Platform / stdlib / one-line rungs (F5, F10, F19, F21, F30, F43, F44, F47, F50, F54, F55, F56, F58, F60, F65) | — | M · implementer (sonnet) ×2 | gate passes | [ ] |
| S23 | Finish | S20–S22 | `finish` skill | gate passes | [ ] |

### Session 6 — High-risk structure and close

- **Starts from:** session 5 committed
- **Ends with:** A10, A11
- **Commit:** yes

| Id | Step | Depends on | Runner | Done when | OK |
|---|---|---|---|---|---|
| S24 | Fold the three core Node file-system adapters (F34) | — | H · implementer (opus) | behaviour-pinning tests pass before and after | [ ] |
| S25 | Page probe check, then replace or keep (F27, D10) | — | M · implementer (sonnet) + `verify` | D10 resolved | [ ] |
| S26 | Move vscode-free code to core node folders (D11) | S24 | M · code-mapper → module-splitter (sonnet) | depcruise passes; no `vscode` import moved | [ ] |
| S27 | Ratchet: knip, jscpd and depcruise baselines down; measure net lines | S24–S26 | L · `check` skill (haiku) | A10 | [ ] |
| S28 | Finish and verify every app | S27 | `finish` + `verify` | A11 | [ ] |

### Step blocks

#### S1 — Terminal sync `listDir`
- **Do:** write a failing test first: a local `LocalFileSystem` whose `listDir` throws EACCES for one folder, with that folder in the base manifest and unchanged on the remote, must produce no `remove`. Then make `NodeLocalFileSystem.listDir` return `[]` only on ENOENT and throw otherwise, as `NodeLibraryFileSystem.listDir` does; `scanLocalTree` already skips a throwing folder with a WARN.
- **Touch:** `packages/core/src/library/node/nodeLocalFileSystem.ts`, its test. **Do not touch:** `syncDiff.ts`, `syncApply.ts` (door: sync — the fix is in the adapter).
- **Context:** `nodeLocalFileSystem.ts:12-18` (bare catch) → `treeScan.ts:26-32` → `syncDiff.ts:43-44` (`local-deleted`) → `syncApply.ts:120-125` (`provider.remove`). Only the terminal uses this adapter (`terminalSync.ts:36`). Also log the error with the folder path.
- **Done when:** A1.

#### S2 — Silent catches
- **Do:** log with context through the injected `ILogger` at: core `import/registries/http.ts`, `fetchLandingPage`, `resolveFirstIdentifier(...).catch(() => undefined)` in `PdfImportParser`; browser `platform/logger.ts` `persist`/`hydrate` (console only — it is the logger), `BrowserDriveAuth.revoke`/`refreshSilently`, `scheduleSyncSoon(...).catch`, helperTab `tabs.remove`. Keep the fallback behaviour; add the log line.
- **Done when:** A2; `rg 'catch \(\(\) => undefined\)|catch \{\s*\}'` over those files returns nothing.

#### S3 — Trust boundaries and small bugs
- **Do:** one `isPdfBytes` (strictest current rule) used by `paperImport.ts:30,84-86`, `PdfImportParser.ts:166-171`, `pdfFinding/download/pdfBytes.ts` (F64); browser `captureService.ts:209-218` and `library-page/router.ts:9-12` use core `isLibraryPath` (F67); terminal `doctor.ts` reads the last-run file with core `readSyncRunRecord`, exported from the sync barrel (F62); terminal `importInputs.ts:21` reports a skipped file by its path, not the typed text.
- **Done when:** A3.

#### S5–S6 — AI layer
- **Do:** S5 maps, from `packages/vscode/src/ai/**`, `pdf-viewer/readingActivity.ts`, `registerAiCommands.ts` and `packages/core/src/ai/**`, what the reader's text search and OCR need and what only feeds the stores in D2. S6 deletes the rest: reading events (`readingActivity.ts`, `readingEventsStore.ts`, `ReaderActivityPort`), `aiMetadataStore.ts` (keep a paper_id → content hash table if the indexer needs it), heuristics + `extractMetadata`, `citationExtractor`, `termNovelty`, `CitationNode/Edge`, chunker one-value options, `IndexerQueue` → promise tail, `AI_INDEX_*` events, `status()`, both search commands and the stance detector; `collectPageTexts` → core `extractPageTexts` (F20); SHA-1 → core `sha256Hex`, read the PDF once (F26). Update `library-format.md:19`.
- **Done when:** A4; `package.json` contributes no deleted command.

#### S7 — Rung-1 deletions
- **Do:** delete the rows' code and the tests that only test it; for F13 delete the `hostConfig` flags and every false branch and CSS rule they guard.
- **Done when:** gate passes; knip 0.

#### S9 — Measure keys
- **Do:** on a copy of the user's library (memory recipe "Extension host e2e"), re-run local metadata extraction on every PDF and count: papers whose `fieldSources.authors` is below 60, and how many of their `makeCiteKey` no-author keys collide. Record the numbers in §8 and resolve D7. Never write to the real library or Drive.
- **Done when:** D7 holds a number.

#### S10 — Council decisions
- **Do:** add `resolvePaperRefs` (D4) with tests; vscode `refsFor` and terminal `refs` call it with their own lookup (terminal keeps rescan-on-miss and applies it to move and trash too, which fixes its inconsistency). Replace `buildCiteKey` with `makeCiteKey` behind the trusted-author gate (D6, D7); delete `import/pdf/citeKey.ts`, its barrel line and test; add the scheme to `library-format.md`.
- **Door:** one-way (on-disk folder names for new imports). **Done when:** A5, A6.

#### S11 — Shared core pieces
- **Do:** split in two parallel packages with disjoint files. (a) library-ui: outcome copy (F32), sidecar reads (F31), folder label + `ROOT_LABEL` (F29), `askNoPdf` (F39), frame CSS (F66); (b) sync/node/terminal: `describeSyncOutcome` (F23), `diskSyncTarget` (F46), `renderPagePng` (F37), `textLayerSummary` (F40), citeCopy `joined` to the core root (F57).
- **Done when:** A7; jscpd shows none of the listed pairs.

#### S12 — Browser onto core
- **Do:** BrowserLogger → core `Logger` with a storage-ring sink and a console sink, created once in each composition root and injected (F8, AGENTS §1); one `sendRuntime` plus core `errorMessage` (F18); `SyncStatusData` → core `DriveStatus` + `driveStatusOf` (F28).

#### S14 — Settings webview
- **Do:** `viewsWelcome` entries for library path, Drive connect/sync/disconnect and "Open settings"; delete `ui/settings/**`, `registerSettingsView.ts`, its bundle entry, the settings-only parts of `syncController.ts` and `settingsShell.ts`. Check `documents/apps/vscode.md`.
- **Door:** manifest (`package.json` views). **Done when:** A8.

#### S15 — Folder tree
- **Do:** `folderTreeFromSnapshot` in core from `snapshot.collections` (check that empty folders appear there first); vscode tree/list and browser `folderTreeStore` use it; delete `folderReader.ts`.

#### S16 — Library root
- **Do:** D9. `resolveLibraryRoot` reads the shared config only; the migration copies a globalState-only root once and clears it. Update `library-format.md` "Shared configuration".
- **Door:** one-way (user data). **Done when:** A9.

#### S20–S22, S24–S26
- **Do:** each F-row in §9 names the file, the finding and the reuse target; apply it, delete what it replaces, keep the never-cut items (AGENTS §3). S21 follows D12. S24 first writes tests that pin the current listDir/rename/trash/stat behaviour of each adapter, then folds them into one with ENOENT-only `listDir` and a rename that refuses to overwrite. S25 follows D10. S26 follows D11.

## 7. Risks

- **R1** Deleting the AI layer removes something a hidden path reads — S5 maps first; `verify` the reader in S6.
- **R2** The cite-key gate makes new local keys uglier — accepted (D6); S9 measures before S10 ships.
- **R3** The root migration loses a user's library location — test with a globalState-only fixture; the migration logs what it copied.
- **R4** Calibration bias: closing steps get under-scoped — S27 is its own step and owns the baselines.

## 8. Log

- 2026-10-15 (agent-tooling session 8): plan written from the ladder audit (five Opus reviewers, two Explore fact checks, two councils). Raw counts: knip 0, depcruise 0, jscpd 30 clones at minTokens 40.

## 9. Findings

Ranked by lines saved × risk weight (low 3, med 2, high 1). Rung: 1 needs to exist? · 2 already in the codebase · 3 platform or stdlib · 5 one line · 6 minimum code. Paths are under `packages/<pkg>/src/` unless the row says otherwise.

| Id | Finding | Where | Rung | Lines | Risk | Step |
|---|---|---|---|---|---|---|
| F1 | AI layer: reading events, AI metadata store, heuristics/extractMetadata, termNovelty, citationExtractor, CitationNode/Edge, chunker one-value options, indexer queue/status/events, ai.searchByText/searchByClaim + stanceDetector (user decision) | vscode ai/**, pdf-viewer/readingActivity.ts, core ai/heuristics, ai/types, ai/chunking | 1 | 900 | low | S6 |
| F2 | VS Code settings webview replaced by viewsWelcome + status bar + native settings (user decision); bundle shell duplicate goes with it | vscode ui/settings/**, registerSettingsView.ts, syncController.ts:56-57,140-158, build/webviews.mjs:18, listPanelHtml.ts:14-34 | 3 | 375 | med | S14 |
| F3 | VS Code tree/list rescan disk; snapshot.collections already has children + totals; browser builds a third tree → core folderTreeFromSnapshot | vscode ui/library/folderReader.ts, libraryTreeDataProvider.ts, listSnapshots.ts:12-25; browser storage/folderTreeStore.ts:8-30 | 2 | 68 | med | S15 |
| F4 | ThemeManager stateless/always auto; PdfRenderer one-method class; field remap | vscode pdf-viewer/ThemeManager.ts, renderer/PdfRenderer.ts | 5 | 45 | low | S17 |
| F5 | Browser build: hand-rolled recursive copies, redundant copyDir(assets), exists() | browser build/copyAssets.mjs:1-59, vendorReader.mjs:16-25 | 3 | 40 | low | S22 |
| F6 | Bibliographic fields declared 5×, listed 2× at runtime → one type + one field list in model/ | core import/metadata/types.ts, importedRecord.ts, import/pdf/types.ts, model/paperRecord.ts, resolution/recordMetadata.ts | 2 | 40 | low | S20 |
| F7 | Browser capture pipeline repeats core network import (resolve → findPdf → writeImportedPaper); split importLandingPage into resolve + write; metadata field spread uses metadataFields | browser capture/captureService.ts:61-138, addPaperFlow.ts:25-70; core networkImport | 2 | 54 | med | S21 |
| F8 | BrowserLogger re-implements core Logger; ~10 module-level instances → composition root; Logger options with one value | browser platform/logger.ts:14-100; core logging/logger.ts, ports/logSink.ts | 2 | 35 | low | S12 |
| F9 | String-keyed eventBus duplicates vscode.EventEmitter and swallows listener errors | vscode events/eventBus.ts, events.ts | 3 | 35 | low | S17 |
| F10 | Reader h()/byId() duplicate ui/dom el()/$() (~80 call sites) | core reader/dom/elements/dom.ts:5-38 | 2 | 28 | low | S22 |
| F11 | Four hand-rolled fetch deadlines | core import/pdfFinding/timeout.ts, registries/http.ts:19-35, landing/landingPage.ts:22-24, timedFetch.ts:21, fetchOnce.ts:23 | 3 | 25 | low | S20 |
| F12 | FolderService class: one caller, sep always "/", results ignored → two functions | core library/folderService.ts | 6 | 25 | low | S20 |
| F13 | library-ui host flags true in both hosts; false branches serve only tests | core library-ui/hostConfig.ts + 10 sites | 1 | 25 | low | S7 |
| F14 | Small vscode duplicates: resolvePaper/pickPaper, formatStatus/STATUS_LABEL, require/reconfigure, add-paper dialog ×2, refreshViews ×2 | vscode commands/registerCommands/paperResolution.ts:43-85, libraryRootController.ts:46-64, registerLibraryCommands.ts:45-58, importCommands.ts:13-25, folderCommands.ts:93,107 | 2 | 25 | low | S17 |
| F15 | relocate/removePapersUnder void args; setStatus loops → N reindexes | vscode core/paperService.ts:66-68,142-153; list/host/paperHandlers.ts:9-15 | 2 | 25 | low | S17 |
| F16 | crumbs used only by its test | terminal ui/format.ts:1-9 + test | 1 | 21 | low | S7 |
| F17 | App glue around core mutations: one core resolvePaperRefs(ids, lookup), lookup injected (council) | vscode core/paperService.ts:183-198; terminal library/papers/paperService.ts:84-124 | 2 | 30 | med | S10 |
| F18 | runtime send() ×4, error text ×2 | browser options/runtimeSend.ts, popup/runtimeSend.ts, library-page/host/runtimeRequests.ts:5-21, content/scholar.ts:59-63 | 2 | 18 | low | S12 |
| F19 | readerSyncReason file + test for a one-caller ternary | browser reader/readerSyncReason.ts | 5 | 18 | low | S22 |
| F20 | pdfTextExtractor.collectPageTexts ≈ core extractPageTexts | vscode ai/pdf/pdfTextExtractor.ts:36-52 | 2 | 18 | low | S6 |
| F21 | Terminal argv parser → node:util parseArgs | terminal cli/args.ts:9-46 | 3 | 25 | med | S22 |
| F22 | Terminal planImports/importAny reimplement core importPaths / importNetworkInput | terminal library/papers/importInputs.ts, paperService.ts:192-215 | 2 | 25 | med | S21 |
| F23 | Sync-result text written 3× with 3 wordings → core describeSyncOutcome | terminal cli/syncCommands.ts:9-25, ui/app/actions/driveSync.ts:6-44; vscode sync/adapter/syncReport.ts:10-40 | 2 | 25 | med | S11 |
| F24 | Library root stored twice (globalState + shared config) → shared config only, globalState read once in migrations/ | vscode storage/paths/libraryLocation.ts:16-58, hostAdapters.ts:28-29, libraryRootController.ts:79 | 1 | 25 | med | S16 |
| F25 | Two lookup clients; registry one ignores injected fetch, hard-codes contact e-mail, swallows failures | core import/registries/http.ts vs pdfFinding/resolvers/timedFetch.ts | 2 | 25 | med | S20 |
| F26 | Hand-rolled SHA-1, PDF read twice per index | vscode ai/pdf/contentHash.ts, aiIndexer.ts:70-74 | 2 | 15 | low | S6 |
| F27 | DOM page probe ≈ core parseHtmlPage, drifted | browser capture/pageProbeContentScript.ts | 2 | 45 | high | S25 |
| F28 | SyncStatusData ≡ DriveStatus, mapping in both apps → core driveStatusOf | browser sync/browserSync.ts:47-55, runtimeMessages.ts:41-46; vscode syncController.ts:149-157 | 2 | 14 | low | S12 |
| F29 | Folder label written 3×; browser "Library" vs core ROOT_LABEL "All Papers"; FolderOption.label read only for root | browser popup/format.ts:19-29, content/scholar.ts:125-129, handlers/library.ts:62-68 | 2 | 14 | low | S11 |
| F30 | Zoom menu re-implements showMenu | core reader/dom/elements/popover.ts:56-81, reader.css:169-179 | 2 | 20 | med | S22 |
| F31 | Sidecar stats/details reads hand-written in both library hosts → core helper with load(id)+ILogger | vscode ui/list/listSnapshots.ts:27-40, list/host/paperData.ts:22-35; browser library-page/host/snapshots/sidecarReads.ts:25-59 | 2 | 20 | med | S11 |
| F32 | Batch outcome notices (tag/move/remove, plural, tag cleaning) drifted between hosts → core notice copy | vscode ui/list/host/paperHandlers.ts:9-49; browser library-page/host/handlers/paperHandlers.ts:14-56 | 2 | 20 | med | S11 |
| F33 | Cite-key: two schemes → makeCiteKey everywhere, trusted authors only (council) | core import/pdf/citeKey.ts, parser/parsedRecord.ts, library/identity/citeKey.ts | 2 | 20 | med | S10 |
| F34 | Three Node file-system adapters for overlapping ports; one only forwards | core library/node/nodeFileSystem.ts, nodeLocalFileSystem.ts, nodeLibraryFileSystem.ts | 6 | 40 | high | S24 |
| F35 | Capture handler twins + repeated find→attach | browser background/handlers/capture.ts:103-145, library.ts:30-35 | 2 | 13 | low | S21 |
| F36 | Debounce Timers injection only for its test | core reader/logic/navigation/debounce.ts | 1 | 12 | low | S7 |
| F37 | pdf.js page → PNG on @napi-rs/canvas duplicated → core import/node renderPagePng (with nativeRenderOptions) | terminal preview/thumbnailWorker.ts:10-35; vscode pdf/node/tesseractOcrEngine.ts:169-195,239-254 | 2 | 15 | med | S11 |
| F38 | Unread reply fields (DraftView.doi/origin, SavedPaperData.citeKey, NoPdfData.pageUrl, TabSummary.active) | browser runtimeMessages.ts:62-168 | 1 | 10 | low | S7 |
| F39 | "No PDF found" dialog built 3× | browser popup/saveFlow.ts:68-80, content/scholar.ts:89-94; core flows/addPaper.ts:22-26 | 2 | 10 | low | S11 |
| F40 | textLayerLabel duplicates core textLayerSummary | terminal ui/preview.ts:56-65 | 2 | 10 | low | S11 |
| F41 | Webview VsCodeApi + listener redeclared per entry | vscode libraryWebview/webviewChannel.ts, reader/vsCodeTransport.ts | 2 | 8 | low | S17 |
| F42 | describeError pattern: 2 helpers + ~10 inline copies | core library/mutations/context.ts:43-45, scan/scanEnv.ts:28-30 | 2 | 8 | low | S20 |
| F43 | THEME_PRESETS re-tabulates READER_THEMES | core reader/themePresets.ts | 5 | 8 | low | S22 |
| F44 | DriveAccount wraps login/logout only | terminal sync/driveAccount.ts | 5 | 8 | low | S22 |
| F45 | Folder tree key range inline; pdfDirs ≈ scanLibrary | browser storage/folderTreeStore.ts, paperRecordStore.ts:44 | 6 | 8 | low | S15 |
| F46 | Disk SyncTarget built the same way in two apps → core diskSyncTarget | vscode syncController.ts:163-172; terminal sync/terminalSync.ts:36-42 | 2 | 8 | low | S11 |
| F47 | Widget surface block repeated; unused @keyframes ls-slide | core ui/dom/base.css:143-147,167-171,191-195,209 | 6 | 7 | low | S22 |
| F48 | Duplicate settings key and default; ping never sent | browser autoSyncScheduler.ts:9, generalForm.ts:8, runtimeMessages.ts:7, router.ts:54 | 1 | 7 | low | S7 |
| F49 | Import claim → mkdir → write PDF → write artifacts repeated | core networkImport/writeImportedPaper.ts:28-42, mutations/import/paperImport.ts:62-72 | 2 | 10 | med | S21 |
| F50 | Hand-rolled hex nonce | core ui/createNonce.ts | 3 | 10 | med | S22 |
| F51 | Accent folding re-written 4× beside fold() | core identity/titleKey.ts, identity/citeKey.ts, resolution/titleAgreement.ts | 2 | 6 | low | S20 |
| F52 | stripHtml ≈ xmlText, trimmed ≈ asString | core registries/text.ts:22-32, metadata/fieldValue.ts:7-9 | 2 | 6 | low | S20 |
| F53 | urlParts avoids URL needlessly | core pdfFinding/urlParts.ts, landing/pdfCandidates.ts:41 | 3 | 6 | low | S20 |
| F54 | SortKey subset of PaperSortKey; identity SORT_LABEL; third key list | terminal app/config.ts:12, ui/app/types.ts:57, cli/libraryCommands.ts:25 | 2 | 6 | low | S22 |
| F55 | Hand-written papersUnder + status counts | terminal ui/preview.ts:170-173,211-215 | 2 | 6 | low | S22 |
| F56 | "print failures, return 1" ×3 | terminal cli/libraryCommands.ts:176-199 | 6 | 6 | low | S22 |
| F57 | BibTeX/cite-key join duplicates core citeCopy joined (neutral code under dom/) | terminal paperService.ts:221-223, ui/app/actions/paperExportActions.ts:18-38 | 2 | 6 | low | S11 |
| F58 | Badge polls 1 s though coordinator emits onStatus | browser background/badgeUpdater.ts:24-60 | 3 | 8 | med | S22 |
| F59 | lookupItemFor repeats idsFromHit | browser content/scholarParse.ts:87-91, capture/scholarCapture.ts:17-21 | 2 | 5 | low | S21 |
| F60 | resolveTerminalOAuthClient one-line forward | terminal sync/terminalAuth.ts:6-9 | 5 | 5 | low | S22 |
| F61 | Search index filterFor: only real one in terminal, vscode passes noop → LibraryStore built-in | terminal library/paperSearchIndex.ts, libraryModel.ts:22; vscode buildServices.ts:55 | 6 | 6 | med | S21 |
| F62 | doctor JSON.parse unchecked → readSyncRunRecord | terminal cli/doctor.ts:36,49 | 2 | 4 | low | S3 |
| F63 | Library read twice after sync | browser library-page/statusBar/syncStatus.ts:35, main.ts:39 | 1 | 4 | low | S7 |
| F64 | Three %PDF- checks of different strictness → one isPdfBytes (trust boundary) | core paperImport.ts:30,84-86, PdfImportParser.ts:166-171, pdfFinding/download/pdfBytes.ts | 2 | 10 | high | S3 |
| F65 | Three inline ~ expansions | terminal importInputs.ts:17, promptSubmit.ts:79, promptCompletion.ts:48 | 2 | 3 | low | S22 |
| F66 | Same full-height frame rules in both hosts | browser library-page/page.css:5-7; vscode libraryWebview/page.css:2-4 | 2 | 3 | low | S11 |
| F67 | Browser path validation repeats isLibraryPath (trust boundary) | browser captureService.ts:209-218, library-page/router.ts:9-12 | 2 | 5 | high | S3 |
| F68 | Config file read twice | terminal main.ts:152 | 1 | 1 | low | S7 |
| F69 | Stale comment in escapeHtml | core ui/escapeHtml.ts:4 | 1 | 1 | low | S7 |
| F70 | VscodeFileSystem duplicates core NodeLibraryFileSystem — REJECTED: VS Code FS layer serves remote workspaces and rename uses overwrite:false | vscode storage/vscodeFileSystem.ts | 2 | 0 | high | — |
