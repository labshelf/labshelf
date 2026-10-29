# Contract: LabShelf Helper protocol

Read when you change a message between the browser extension and LabShelf Helper, a limit, the socket handshake, the helper's data folder or how it builds.

LabShelf Helper builds LaTeX and Typst projects for the browser extension. The extension, the standalone helper binary, the VS Code extension and the terminal app all ship separately, and the last two can serve this host too. Any version of the page meets any version of the helper, so the protocol version rises with every change to a message, a limit or the handshake.

## Transport

The page starts the helper through native messaging (`dev.labshelf.helper`) and sends `hello`. The helper answers `ready`, then `session` with a loopback port and a random token. The page opens a WebSocket to `127.0.0.1` and its first frame is `auth` with that token. The helper lives as long as the native port and exits when stdin closes.

The native port is the only channel the browser authenticates (the manifest names the allowed extension). The token carries that identity to the socket, because any local process or web page can reach a loopback port. So the helper refuses and logs the reason when:

- the socket's `Origin` differs from the origin `hello` sent, is not `chrome-extension://<id>` or `moz-extension://<uuid>`, or differs from the caller origin Chrome passes as first argument;
- the first frame is not a correct `auth` within a short time limit;
- a second socket presents the token. One token serves one socket; a reconnect goes through a new native port.

Native frames from the helper stay under the browser's host-message limit.

PLATFORM: Firefox upgrades `ws://` to `wss://` under `upgrade-insecure-requests`, so the Firefox manifest's `extension_pages` CSP must not carry that directive.

## Messages

Every message has `v`, an `id` of 1 to 64 characters chosen by the page, and a `type`. Replies and `progress` carry the request's `id`; only an `error` for a frame without a valid `id` has none. Unknown keys are dropped on read.

- `root` of `openProject`, and every later `path`, `main` and `editedFile`, resolve with the [bridge's confinement](bridge.md#paths) under the library root of the [shared configuration](library-format.md#shared-configuration). Escaping, also through a symlink, is refused with `path`. A `projectId` that was not opened is refused with `project-id`.
- Builds and edits never write into the library. The helper builds a copy with the unsaved text in place. `save` means the page wrote the file itself: the helper drops its unsaved text and rereads.
- An `edit` carries the whole text or non-overlapping `changes` in UTF-16 offsets of the previous version. Changes that do not apply answer `stale` and the page sends the whole text.
- `pages` carries only the pages that differ from the last `pages` on this socket for the project, all of them after `openProject`. A successful build sends `pages` even when nothing changed.
- A `.typ` compile runs the bundled WASM Typst compiler with fonts and packages only from the helper's data folder.
- `installPython` installs the managed Python ([managed-tools.md](managed-tools.md#python)) and answers `progress` with phase `python`, then `ready`; a failure answers `error` with code `python-install-failed`.
- `runCell` `{code, cwd, timeoutMs}` runs one code cell with the managed Python and answers `cellResult` `{status, latex?, text?, error?, durationMs}` under the same `id`; `status` is `ok`, `error`, `timeout`, `cancelled` or `missing-python`. `code` is at most 1 MiB (larger is refused with `limit`) and `timeoutMs` an integer from 1 to 600000. `cwd` is a scope, never a path: a project id or `paper:<paperId>`. A project id resolves to the folder of that project while it is open, `paper:<paperId>` to the temp folder; an unknown scope is refused with an `error` under the request `id` and nothing runs. A malformed scope is refused with `project-id`.
- `cancelCell` `{requestId}` aborts the run that `runCell` started under that `id`, which then answers `cellResult` with `cancelled`. It does not wait in the queue behind other messages, and for an id that is not running it answers nothing.
- `ready` carries `python` (`missing` or `installed`) when the host reports it, on `hello` and after an install. A helper that omits it predates Python.
- `texlive-rollover` means a managed TeX Live is a year behind the package repository. The page asks before reinstalling ([managed-tools.md](managed-tools.md#rollover)).
- `publishTemplate` follows [templates.md](templates.md#publish): it publishes saved files only, repeats every check on a snapshot before submitting and keeps no GitHub token on disk.

## Version

The protocol version is 7. The page compares `ready.protocol` with its own. A lower helper version asks to update the program that `host` names; a higher one asks to update LabShelf in the browser. When the helper refuses `hello` for `version`, its `error` carries the helper's `v` so the page can tell which side is older. It cannot know the host then, so it names LabShelf Helper, the VS Code extension and the terminal app. The page never shows the raw error. The standalone helper then runs its update check at once.

## Data folder

The data folder holds the build copies (`projects/<projectId>/src`, with latexmk output kept in `build/`), template publication snapshots (`publishing/`, deleted when done), Typst fonts and packages, biber's WASM tree named by its sha256, `bin/` and `logs/`. The managed TeX and Python are not here: they are in the folder every app shares ([managed-tools.md](managed-tools.md)).

On macOS and Linux the folder and `logs/` are `0o700` and log files `0o600`. The standalone helper exits non-zero, naming the path, when its binary, the folder holding it (unless root owns it), its data folder or `bin/` is writable by group or others.

## Registration and updates

- `labshelf-helper --register` writes the manifests of this host and of the [bridge](bridge.md) for every supported browser; `--unregister` removes both. `--uninstall` also removes the bridge name and `bin/`, keeping projects and the shared managed tools (TeX and Python). It writes nothing outside the user's home. Precedence over the desktop apps' launchers is in [native-host.md](native-host.md#precedence).
- Only the standalone binary updates itself, rate-limited after `hello`, from `latest.json` of the latest GitHub release. It accepts an update only when the Ed25519 signature verifies against the built-in key and the download matches its `sha256`. The new binary runs from the next launch.

## Build safety

- TeX never runs with shell-escape: `-no-shell-escape`, `openout_any` and `openin_any` set to `p`, and latexmk with `-norc` so no `latexmkrc` runs. A project that needs shell-escape ends `needs-shell-escape`.
- On macOS and Linux the helper serves as latexmk's biber (`--biber --root <project>`). It runs biber's WASM build in-process when the `.bcf` version matches and every data source is local, else the TeX's own `biber`. It refuses a data source outside the project, the build folder and `TEXMFROOT`.
