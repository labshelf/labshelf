# Session 5 — Browser on the folder through the bridge

- **Goal:** with the bridge, the browser extension shows and edits the same library folder as VS Code and the terminal; without it, the in-browser library works and warns the user.
- **Starts from:** session 4 committed (bridge host, protocol and installers exist).
- **Ends with:** A7, A8; the whole plan's acceptance.
- **Owns:** `packages/browser/**`, `documents/apps/browser.md`, `documents/product.md`.

Context: a library is a folder synced by the user's tool; the browser reaches it through the Native Messaging bridge. Design: `documents/plans/folder-sync/research/bridge-design.md` ("Browser side"). The ad-hoc `new IndexedDbFileSystem()` sites and the storage ports are listed in `research/browser-sync-glue.md` ("Storage facts").

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 5.1 | One injected library file system | behaviour | implementer (sonnet) | browser tests pass, no ad-hoc construction left | [ ] |
| 5.2 | Bridge file system, source choice, move to folder | contract | implementer (opus) + `architecture-reviewer` | tests | [ ] |
| 5.3 | Warning, connect and status UI | behaviour | main thread: `ui-design`, then implementer (sonnet) | user checks by hand | [ ] |
| 5.4 | Check, commit | — | `check` on Owns, `git commit` | gate passes | [ ] |
| 5.5 | Finish the plan | — | `finish` skill (sonnet) on everything the plan touched | findings fixed | [ ] |

5.1, then 5.2, then 5.3; 5.5 after 5.4.

## 5.1 — One injected library file system

- **Goal:** every browser module gets the library `LocalFileSystem` from one factory instead of building `IndexedDbFileSystem` itself.
- **Read only:** `research/browser-sync-glue.md` ("Storage facts"), `core/src/ports/localFileSystem.ts`, `browser/src/storage/{indexedDbFileSystem,libraryMutations,idbSidecarPort,paperRecordStore,folderTreeStore}.ts`, `browser/src/background/index.ts`, `browser/src/library-page/host/hostContext.ts`.
- **Decided:** no behaviour change (still IndexedDB); the factory lives in `browser/src/storage/` and is what 5.2 switches.
- **Done when:** browser typecheck + test; `grep -rn "new IndexedDbFileSystem" packages/browser/src` finds only the factory.

## 5.2 — Bridge file system, source choice, move to folder

- **Goal:** `BridgeFileSystem` over `runtime.connectNative`, the one-source rule, and moving an in-browser library into the folder.
- **Read only:** `research/bridge-design.md` ("Browser side"), `documents/contracts/bridge.md`, the core bridge protocol exports, the 5.1 factory, `browser/src/storage/{idbSidecarPort,paperRecordStore}.ts`, `browser/manifest.chrome.json`, `manifest.firefox.json`.
- **Decided:** as in the entry. `changed` events call `rebuildFromFiles()` and the `library.changed` broadcast; captures write through the factory, so they land in the folder. Manifest gains `nativeMessaging` (optional if both browsers allow it). Tests first: source choice (bridge up/down/protocol mismatch), chunked read/write against a fake port, the move (copy, sidecar mapping, verify, clear; existing ids skipped; failure leaves IndexedDB intact).
- **Done when:** tests pass; browser typecheck + test.

## 5.3 — Warning, connect and status UI

- **Goal:** the UI texts of `research/bridge-design.md` ("Browser side"): the uninstall warning with "Save to a folder on this computer", the move offer, and in options the source ("Folder: ~/Dropbox/LabShelf" or "This browser").
- **Steps:** main thread runs the `ui-design` skill (core components, tokens, icons, product vocabulary), then an implementer builds it. A failing bridge shows why (not installed, Flatpak/Snap, protocol mismatch).
- **Done when:** browser typecheck; the user checks by hand with and without the bridge.
