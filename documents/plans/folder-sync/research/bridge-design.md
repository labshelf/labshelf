sha: 3159f508
files: packages/core/src/bridge/**, packages/browser/src/storage/**, packages/browser/manifest.*.json
source: design agreed in conversation, 2026-10-17; Native Messaging facts from browser docs (verify in 4.1/4.2)

# Bridge — agreed design

## Shape
- The browser starts a local host program through Native Messaging; no port is opened, no server, no account.
- The host reads and writes the library folder whose root is in the shared config (`~/.config/labshelf/config.json`). The browser never sends paths outside the library.
- Host name `app.labshelf.bridge` (reverse-DNS, lowercase as Chrome requires).

## Protocol (`core/src/bridge/`, runtime-neutral; contract `documents/contracts/bridge.md`)
- Native Messaging framing: 4-byte little-endian length + UTF-8 JSON. The host→browser message limit is 1 MB, so file bytes travel as base64 chunks of at most 512 KB.
- Request `{id, op, …}` → response `{id, ok, result|error}`. Ops:
  - `hello` → `{protocol, libraryRoot, paperCount}`;
  - the `LocalFileSystem` port ops (`listDir`, `stat`, `readFile`, `writeFile`, `deleteFile`, `ensureDir`) plus `rename`;
  - `readFile` streams `chunk` messages and ends with `done`;
  - `writeFile` sends chunks and then `commit`, which the host writes atomically.
- Events `{event:"changed", paths}` from a watcher on the library.
- Errors carry `code` (`notFound`, `outsideLibrary`, `noLibrary`, `protocol`, `io`) and a message.
- `protocol` is an integer. Both sides refuse a different major with a clear message.

## Host (`core/src/bridge/node/`)
- Every relative path is resolved under the library root. `..`, absolute paths and symlinks that escape the root are refused.
- Atomic writes go through `core/src/library/node/atomicWrite.ts`. The host logs to the device-local logs dir (session 2) through `ILogger`.
- The host exits when stdin closes.

## Install (`core/src/bridge/node/install/`)
- Host manifest `{name, description, path, type:"stdio", allowed_origins|allowed_extensions}`.
- Locations to verify against official docs:
  - Chrome, macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
  - Chrome, Linux: `~/.config/google-chrome/NativeMessagingHosts/`
  - Chromium: `~/.config/chromium/…`
  - Brave: `~/.config/BraveSoftware/Brave-Browser/…` (macOS equivalents under Application Support)
  - Firefox: `~/.mozilla/native-messaging-hosts/`, macOS `~/Library/Application Support/Mozilla/NativeMessagingHosts/`
  - Windows: registry keys under `HKCU\Software\<vendor>\NativeMessagingHosts\<name>` (Chrome, Brave, Firefox) pointing to the manifest
- `path` points to a launcher (`sh` on macOS/Linux, `.cmd` on Windows) that runs the bundled host script with the Node that installed it:
  - VS Code: `process.execPath` with `ELECTRON_RUN_AS_NODE=1`;
  - terminal: its own `process.execPath`.
- Extension ids: `allowed_origins` needs the Chrome store id and the dev id. Find how the extension id is fixed (manifest `key`?). Firefox uses the `gecko` id from `manifest.firefox.json`.
- Flatpak or Snap browsers on Linux cannot start host programs outside the sandbox. Detect them and tell the user.

## Browser side (session 5)
- Single injected `LocalFileSystem` factory replaces the ad-hoc `new IndexedDbFileSystem()` sites (list in `research/browser-sync-glue.md`).
- `BridgeFileSystem` implements the port over `runtime.connectNative`. In MV3 the port dies when the service worker sleeps, so connect lazily and reconnect per request batch.
- One source at a time: the bridge when `hello` succeeds, otherwise IndexedDB. Never both.
- On the first successful `hello` while IndexedDB holds papers, offer "Move N papers to <folder>":
  - copy papers and sidecars (`appdata/<id>/data.json` → `.research/papers/<id>/data.json`);
  - verify, then clear IndexedDB;
  - a paper id that already exists in the folder is skipped and reported.
  - This is a data-loss path and needs tests.
- `nativeMessaging` permission: optional if both Chrome and Firefox allow it as optional (verify), requested on "Connect"; otherwise required.
- Without the bridge, the library page and popup show: "Your library lives in this browser. Uninstalling the extension deletes it." [Save to a folder on this computer]. The button explains installing LabShelf for VS Code or the terminal and running "Connect the Browser".
