# Managed tools

Every LabShelf app on a machine (the helper, the VS Code extension and the terminal app) uses one managed TeX and one managed Tinymist per user, kept in one shared folder. The managed TeX module in core (`writing/latex/toolchain/node/managed`) and the managed Tinymist module (`writing/typst/toolchain`) implement this document for every app.

## Folder

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/LabShelf/` |
| Windows | `%LOCALAPPDATA%\LabShelf\` (`<home>\AppData\Local` when the variable is unset) |
| Linux | `$XDG_DATA_HOME/labshelf/` (`~/.local/share` when the variable is unset or empty) |

Each tool has its own subfolder, `tex/` or `tinymist/`, with its own `.lock`. The lock rules below hold for both.

## TeX layout

The `tex/` subfolder:

```
tinytex/                TinyTeX, installed for this user without admin rights
texlive/                a full TeX Live (scheme-full), installed with install-tl
user/                   TEXMFHOME, TEXMFVAR and TEXMFCONFIG of the TeX Live install
tinytex-packages.txt    the TinyTeX package list written before a rollover reinstall
.staging-<kind>-*/      an install in progress, removed when it ends
.lock                   present while an app changes the folder
```

A `tinytex/` or `texlive/` tree counts as installed once it has a `bin/<arch>/` folder; installers build the tree in a staging folder and move it in only when it is complete. When both exist, `texlive/` is used. The release year comes from the tree's `release-texlive.txt`.

Downloads: TinyTeX is pinned by version and SHA-256 in core. install-tl is checked against CTAN's SHA-512 file, and that file against its OpenPGP signature by the TeX Live key pinned in core. A download that fails either check is not installed.

## Lock

Only LabShelf apps change a tool's subfolder, and only while they hold its `.lock`. An app creates the file exclusively, with the JSON `{ "pid": <number>, "operation": "<what it does>", "startedAt": "<ISO time>" }`, and removes it when the change ends, whether it succeeded or failed.

A lock is stale when its `pid` is not a running process, or when its content is not that JSON and the file is older than the wait limit. An app takes over a stale lock and logs its content. Otherwise it waits, checking every 500 ms for up to 15 minutes, then fails with an error naming its own operation and the holder.

After taking the lock an app looks at the subfolder again: what another app installed during the wait is not installed a second time.

Installing TeX, installing every package, installing a missing package, the rollover reinstall and installing Tinymist run under their subfolder's lock. Reading the status and resolving latexmk or Tinymist do not take it.

## TeX resolution

A build uses the managed TeX first, then a TeX on the system, and reports TeX as missing when neither exists. A system TeX is never changed: no package installs, no updates.

## Missing packages

When a build stops on a missing file and the managed TeX is TinyTeX, the app asks tlmgr which package provides the file, installs it and builds again, at most 10 rounds per build. The loop lives in the core build. A full TeX Live already has every package.

## Rollover

Once a year the package repository moves to the next TeX Live release and tlmgr refuses every repository action. TinyTeX is then reinstalled without asking, and the packages it had are installed again from `tinytex-packages.txt`. A full TeX Live is left unchanged until the user confirms its reinstall.

## Download all packages

"Download all packages" installs `scheme-full` into a managed TinyTeX, so a build never stops to install one. It needs a managed TeX; a full TeX Live already counts as complete.

## Tinymist

Tinymist is the Typst language server and compiler LabShelf runs for Typst projects: the helper for the browser extension, and the VS Code extension as its Typst language server. It is installed on the first Typst use and never asked about.

```
tinymist/
  <version>/tinymist    the binary (tinymist.exe on Windows)
  .staging-*/           a download in progress, removed when it ends
  .lock
```

Core pins one Tinymist version and the SHA-256 of its release asset for each supported OS and architecture. The app downloads the asset of that version from Tinymist's GitHub release, refuses it unless the hash matches, and moves the binary into `<version>/` only once it is complete and executable. A pinned version that changes installs the new one beside the old and removes older version folders after the move. An OS or architecture without a pinned asset has no managed Tinymist.

Resolution: the managed binary of the pinned version, then `tinymist` on `PATH`, then missing. A Tinymist on the system is never changed.
