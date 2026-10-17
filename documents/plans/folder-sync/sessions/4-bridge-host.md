# Session 4 — Bridge: protocol, host and installers

- **Goal:** a local Native Messaging host gives the browser extension read/write access to the library folder, installed from VS Code or the terminal.
- **Starts from:** session 3 committed (device-local logs dir and atomic writes in core).
- **Ends with:** host and installers work; A7 needs session 5.
- **Owns:** `packages/core/src/bridge/**`, `packages/core/__tests__/bridge/**`, `packages/core/src/index.ts` and `node/index.ts` (bridge exports only), new `packages/vscode/src/bridge/**`, `packages/vscode/package.json` (one command), `packages/vscode/build/*.mjs`, `packages/vscode/src/extension.ts` (one registration), new `packages/terminal/src/cli/bridgeCommands.ts`, `packages/terminal/src/cli/{index,usage}.ts`, `packages/terminal/build/*.mjs`, `documents/contracts/bridge.md`, `documents/apps/{vscode,terminal}.md`, `documents/README.md` (one row).

Context: the library is a folder synced by the user's tool; the browser extension reaches it through this bridge instead of keeping its own copy. Design: `documents/plans/folder-sync/research/bridge-design.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 4.1 | Protocol, host, `bridge.md` | contract | implementer (opus) + `architecture-reviewer` | protocol and host tests | [ ] |
| 4.2 | Host manifest installer and launcher | contract | implementer (opus) | installer tests with temp HOME | [ ] |
| 4.3 | VS Code "Connect the Browser", terminal `bridge`, bundling | behaviour | implementer (sonnet) | typecheck, test, manual install | [ ] |
| 4.4 | Check, commit | — | `check` on Owns, `git commit` | gate passes | [ ] |

4.1 and 4.2 in parallel (`bridge/` root + `bridge/node/host*` vs `bridge/node/install/`); 4.3 after both.

## 4.1 — Protocol, host, `bridge.md`

- **Goal:** runtime-neutral protocol types and framing in `core/src/bridge/`, Node host in `core/src/bridge/node/`, contract `documents/contracts/bridge.md`.
- **Read only:** `research/bridge-design.md` (Protocol, Host), `core/src/ports/localFileSystem.ts:16-26`, `core/src/library/node/atomicWrite.ts`, `core/src/library/node/sharedConfigFile.ts`, the session 2 state-dir/logs helper, `documents/contracts/sync.md`.
- **Decided:** as in the entry. Tests first: framing round trip, chunked read/write of a 3 MB file, path confinement (`..`, absolute, symlink escape), atomic commit, error codes, protocol mismatch, `changed` events. Add a `CONTRACT: documents/contracts/bridge.md#…` tag where code depends on the contract. Link `bridge.md` from `sync.md` and `documents/README.md`.
- **Done when:** tests pass; core typecheck.

## 4.2 — Host manifest installer and launcher

- **Goal:** `installBridge`, `bridgeStatus`, `uninstallBridge` in `core/src/bridge/node/install/`.
- **Read only:** `research/bridge-design.md` (Install), `packages/browser/manifest.chrome.json` and `manifest.firefox.json` (ids), official Native Messaging docs for Chrome and Firefox (URLs in the test file header).
- **Decided:** HOME, platform and `process.execPath` are injected; Windows registry writes go through an injected runner (`reg add`/`reg delete`) so tests never touch the real registry; detect Flatpak/Snap browsers and return a warning instead of failing. Tests first per browser and OS.
- **Done when:** tests pass; core typecheck.

## 4.3 — VS Code "Connect the Browser", terminal `bridge`, bundling

- **Goal:** users install the bridge with one action.
- **Read only:** `research/bridge-design.md`, the 4.1/4.2 exports, `packages/vscode/build/host.mjs`, `packages/terminal/build/build.mjs`, `packages/vscode/src/activation/registration/index.ts`, `packages/terminal/src/cli/index.ts` and `usage.ts`.
- **Decided:** both builds emit a bundled host script next to the app bundle. VS Code command `labshelf.connectBrowser` ("Connect the Browser"): install, then show which browsers were set up and the extension store links. Terminal: `labshelf bridge install|status|uninstall`.
- **Done when:** vscode and terminal typecheck + test; the user checks on their machine that the manifest and launcher exist and that the launcher answers `hello`.
