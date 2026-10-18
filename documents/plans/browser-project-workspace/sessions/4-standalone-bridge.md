# Session 4 — the standalone helper serves the folder bridge

- **Goal:** LabShelf Helper also answers `app.labshelf.bridge`, so a user with only the helper has an on-disk library the browser reads and the helper builds from.
- **Starts from:** sessions 1–3 committed.
- **Ends with:** `labshelf-helper --register` writes manifests for both hosts and `--unregister` removes both; the SEA binary starts the bridge host when launched for it; `documents/contracts/native-host.md` and `bridge.md` say so.
- **Owns:** `documents/contracts/native-host.md`, `documents/contracts/bridge.md` (host list only), `packages/terminal/src/helper/main.ts`, `packages/terminal/build/sea.mjs`, `packages/terminal/installers/`, `packages/core/src/nativeHost/` (precedence only), their tests.

Runs alone: it changes a build script.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Contract text and failing tests | contract | test-writer (sonnet) after the main thread edits the contract | tests fail for the expected reason | [ ] |
| 4.2 | Helper serves the bridge | contract | implementer (sonnet) | 4.1 passes, real start in headless Chrome for Testing | [ ] |
| 4.3 | Review | — | architecture-reviewer | no Standards or Spec finding left | [ ] |
| 4.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 4.1 — Contract and tests

- **Read only:** `documents/contracts/native-host.md` (Hosts, Precedence); `documents/contracts/bridge.md` (first section); `packages/core/src/nativeHost/hostSpecs.ts`; `packages/core/src/nativeHost/node/install/installNativeHost.ts`, `uninstallNativeHost.ts:23`; `packages/terminal/src/helper/main.ts:1-49`.
- **Decided:** Precedence gains the bridge: the standalone helper's `--register` writes both hosts' manifests pointing at the helper binary, replacing app launchers, exactly as it does for the helper host; an app's install leaves a standalone bridge manifest alone unless the user picks "use this app instead". The sentence "The bridge host has no standalone program" is deleted. Native messaging passes no host name to the program (Chrome passes only the caller origin, Firefox the manifest path and extension id), so each manifest points at its own name: the installer puts `labshelf-bridge` next to `labshelf-helper` (a symlink on macOS and Linux, a `.cmd` shim on Windows), and `main.ts` dispatches on the basename it was started as. Tests: install writes both manifests to the per-browser folders of `native-host.md`; uninstall removes both; dispatch picks the bridge host for the bridge name.
- **Done when:** tests fail because dispatch and the second spec are missing.

## 4.2 — Implementation

- **Read only:** the tests of 4.1; `packages/core/src/bridge/node/hostEntry.ts:1-11`, `runBridgeHost.ts:1-72`; `packages/terminal/build/build.mjs:34` (how the terminal bundles the bridge entry); `packages/terminal/build/sea.mjs`; `packages/terminal/installers/{macos,windows,linux}` (where `--register`/`--unregister` run).
- **Decided:** the SEA bundle includes `runBridgeHost`; the library root comes from `readSharedLibraryRoot` as for the app-hosted bridge; when none is set, the bridge answers its existing "no library" error and the options page lets the user pick a folder through the bridge's existing flow. Installers create and remove the `labshelf-bridge` name with the binary.
- **Done when:** core and terminal typecheck and test; the SEA binary built locally answers a bridge `hello` from an unpacked extension in Chrome for Testing with a scratch `HOME`; report what was not checked (Windows shim, Firefox).
- **Do not touch:** `packages/vscode/`, `packages/core/src/bridge/` except imports.
