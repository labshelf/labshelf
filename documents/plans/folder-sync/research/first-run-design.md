sha: 3159f508
files: packages/core/src/library/node/**, packages/vscode/src/storage/paths/libraryLocation.ts, packages/terminal/src/main.ts
source: design agreed with the user, 2026-10-17; folder locations from tool docs (verify in 3.1)

# First run, sync guide, conflict UI — agreed design

## Sync folder detection (`detectSyncFolders`, core node)
Returns `{tool, path}[]` for folders that exist. Candidates (implementer verifies each against the tool's docs and lists sources in the test file header):
- Dropbox: `~/Dropbox`, plus paths in `~/.dropbox/info.json` (`personal.path`, `business.path`).
- Google Drive for desktop: macOS `~/Library/CloudStorage/GoogleDrive-*/My Drive` (localized names, e.g. `Meu Drive`); Windows the mounted drive's `My Drive`.
- OneDrive: macOS `~/Library/CloudStorage/OneDrive-*`; Windows `%OneDrive%`; `~/OneDrive`.
- iCloud Drive: macOS `~/Library/Mobile Documents/com~apple~CloudDocs`.
- Nextcloud: `~/Nextcloud`, plus `localPath` entries in the client's `nextcloud.cfg`.
- Syncthing: `<folder path>` entries of `config.xml` (`~/.local/state/syncthing`, `~/.config/syncthing`, `~/Library/Application Support/Syncthing`).
Linux has no Google Drive or iCloud client; rclone and Insync users choose a folder by hand.

`inspectLibraryFolder(path)` → `{isLibrary, paperCount}` (library = `markerDirs()`; papers = folders with `metadata.yaml`).

## VS Code first run (replaces `runLibrarySetupWizard`)
Shown when no root is configured (instead of the toast) and by "LabShelf: Configure Library":
```
Where should your library live?
  ~/Dropbox/LabShelf        synced by Dropbox
  ~/Sync/LabShelf           synced by Syncthing
  ~/LabShelf                only on this computer
  Choose a folder…
  How to sync between computers…
```
- A suggestion or chosen folder that already holds a library → "Found your library with N papers. Open it?".
- "Choose a folder…" accepts an existing library directly or creates a new one in the chosen folder.
- "How to sync…" opens the guide (below) in a webview panel.
- Library is local-only → on activation re-run detection; when a sync folder appears: "Found Dropbox. Move the library to ~/Dropbox/LabShelf?" [Move] [Not now] (not again for that tool once dismissed; stored in the shared config namespace `vscode`).
- "LabShelf: Move Library…" → folder picker → `moveLibrary` with progress → services rebuilt on the new root.

## Terminal
- First-run prompt lists the same options as numbered choices; `labshelf init [path]` unchanged; new `labshelf move <path>`.
- `labshelf sync-help` prints the guide as text.

## Sync guide (core)
- Content: runtime-neutral data (per tool: name, one-line pitch, 3 install steps, official link, platforms; plus "No cloud? Syncthing — free, device to device").
- DOM renderer in `core/src/ui/dom/syncGuide/` (design tokens, core icons), used by the VS Code webview and later the browser.
- Terminal text renderer in the terminal app.

## Conflict UI (VS Code, terminal)
- VS Code: after a scan with `ConflictCopy` results, a notification "2 files have conflicting copies" [Resolve]. Resolve = quick pick per copy: Keep mine / Keep the other / Keep both (not for metadata.yaml), each with the file's paper title and the tool name.
- Terminal: status segment "2 conflicts"; `:conflicts` overlay and `labshelf conflicts` list with the same three choices.
- Sidecar conflicts never appear (merged automatically).
