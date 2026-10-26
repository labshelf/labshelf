# Contract: managed tools

Read when you change where the managed TeX lives, its lock, or how a build finds TeX.

The helper, the VS Code extension and the terminal app ship separately but share one managed TeX per user in one folder, `tex/` under the shared tools folder. Two apps can install at once, so every app follows the lock and layout below.

## Layout

`tex/` holds `tinytex/`, `texlive/` (scheme-full, installed with install-tl), `user/` (TEXMFHOME, TEXMFVAR and TEXMFCONFIG of the TeX Live install), `tinytex-packages.txt`, `.staging-<kind>-*/` and `.lock`. A tree counts as installed once it has a `bin/<arch>/` folder. Installers build in a staging folder and move the tree in only when it is complete. When both trees exist, `texlive/` is used. The release year comes from the tree's `release-texlive.txt`.

Downloads are verified: TinyTeX is pinned by SHA-256. install-tl is checked against CTAN's SHA-512 file, and that file against its OpenPGP signature by a pinned TeX Live key. A download that fails a check is not installed.

PLATFORM: on macOS the helper removes the quarantine attribute from the TinyTeX folder after install and on first use, so macOS does not block its binaries.

## Lock

Only LabShelf apps change `tex/`, and only while they hold `.lock`. An app creates it exclusively with the JSON `{ pid, operation, startedAt }` and removes it when the change ends, whether it succeeded or failed.

- A lock is stale when its `pid` is not a running process, or when its content is not that JSON and the file is older than 15 minutes, the wait limit every app uses. An app takes over a stale lock and logs its content.
- Otherwise it waits, up to that limit, then fails with an error naming its operation and the holder.
- After taking the lock an app looks at the folder again, so what another app installed during the wait is not installed twice.

Installs, package installs and the rollover reinstall run under the lock. Reading the status and resolving latexmk do not.

## TeX resolution

A build uses the managed TeX first, then a TeX on the system, and reports TeX as missing when neither exists. A system TeX is never changed: no package installs, no updates. When a build stops on a missing file and the managed TeX is TinyTeX, the core build asks tlmgr for the providing package, installs it and builds again, up to a fixed number of rounds. A full TeX Live has every package.

## Rollover

TRAP: once a year the package repository moves to the next TeX Live release and tlmgr refuses every repository action. TinyTeX is then reinstalled without asking, and its packages are installed again from `tinytex-packages.txt`. A full TeX Live stays unchanged until the user confirms its reinstall.
