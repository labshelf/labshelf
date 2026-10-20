# Contract: LabShelf Helper protocol

Read when you change a message between the browser extension and LabShelf Helper, a limit, the socket handshake or where the helper keeps its data.

LabShelf Helper is a native program that builds LaTeX and Typst projects for the browser extension. An extension page opens a project the helper reads from the library folder on disk, sends it the edits the user types, and asks for builds; the helper runs latexmk with a managed or system TeX and sends back the problems and the pages of the PDF that changed. The extension and the helper ship separately, so a user can run any extension version against any helper version, and every rule below holds across both. The protocol module in core (`writing/helper`) implements this document for both sides.

## Transport

The page reaches the helper in two steps.

1. **Handshake over native messaging.** The helper is a native messaging host named `dev.labshelf.helper`. Each native frame is one UTF-8 JSON object preceded by its byte length as a 32-bit unsigned integer in native byte order, on the helper's stdin (page to helper) and stdout (helper to page). The browser allows frames of at most 1 MB from the helper. The page sends `hello`; the helper answers `ready`, then `session`. The helper process lives as long as this port: when its stdin closes, it closes the socket and exits.
2. **Work over a loopback WebSocket.** The helper listens on `127.0.0.1` on a port the OS picks, for this session only. `session` gives the page the port and a token of 32 random bytes in base64url. The page opens `ws://127.0.0.1:<port>/`; its first frame is `auth` with the token. Every other message runs on the socket.

The helper refuses a socket and logs the reason when:

- the upgrade's `Origin` differs from the origin the page sent in `hello`;
- that origin is not `chrome-extension://<id>` or `moz-extension://<uuid>`, or, when Chrome started the helper with the caller's origin as its first argument, differs from it;
- the first frame is not `auth` with the session's token, it does not arrive within 10 s, or a second socket tries to authenticate, also after the first one closed (the token serves one socket; the page reconnects through a new native port);
- the upgrade asks for a text subprotocol, or a frame sets a reserved bit.

Socket frames are binary WebSocket messages (RFC 6455, text frames refused). The helper accepts no extensions: it ignores the ones the upgrade offers, such as Chrome's `permessage-deflate`, and its 101 response names none. Each message is a 4-byte little-endian length of a UTF-8 JSON envelope, the envelope, then the raw payload bytes the envelope describes (no base64). The helper writes only native frames to stdout; its logs go to `logs/` in its data folder.

Firefox upgrades `ws://` to `wss://` under the CSP directive `upgrade-insecure-requests`, so the Firefox manifest's `extension_pages` CSP does not carry it.

## Envelope

Every message has the same envelope:

```json
{ "v": 5, "id": "7", "type": "compile", "projectId": "thesis", "main": "main.tex", "mode": "preview" }
```

| Key | Type | Notes |
|---|---|---|
| `v` | integer | the protocol version, `5`. A message whose `v` differs is rejected |
| `id` | string | 1 to 64 characters, chosen by the page. A reply carries the `id` of the request it answers, and every `progress` message of a request carries that request's `id`. An `error` for a frame that carried no valid `id` has none |
| `type` | string | one of the messages below for its direction and transport; any other value is rejected |

Keys a message does not define are dropped when it is read.

## Messages

### Page to helper, native messaging

| `type` | Body | Reply |
|---|---|---|
| `hello` | `extensionVersion`: non-empty string; `origin`: the page's `location.origin` | `ready`, then `session` |

### Page to helper, socket

| `type` | Body | Reply |
|---|---|---|
| `auth` | `token` | `authed`; anything else closes the socket |
| `openProject` | `projectId`; `root`: the project folder as a library path ([bridge.md#paths](bridge.md#paths)) | `opened` with `files`: the project's paths |
| `closeProject` | `projectId` | `closed`; the helper drops the project's unsaved text |
| `edit` | `projectId`, `path`, `version`: integer from 1; either `text`, the whole file, or `changes`: `{ from, to, insert }[]`, non-overlapping ranges of UTF-16 offsets in the text of `version - 1` | none; `error` `stale` when `changes` do not apply to the helper's version, and the page then sends `text` |
| `save` | `projectId`, `path` | none; the page wrote the file through its own storage, and the helper drops its unsaved text for it and reads the file from disk again |
| `compile` | `projectId`; `main`; `mode`: `"preview"` or `"full"`; `engine?`: `"pdflatex"`, `"xelatex"` or `"lualatex"` for a `.tex` main; `editedFile?`; `editedLine?`: the 1-based line of the edit in `editedFile`; `haltOnError?`: boolean, stops the LaTeX engine at the first error | `progress`, then `built`, then `pages` when it succeeded |
| `cancel` | `projectId` | the running build ends with `built` `status: "cancelled"` |
| `installTex` | `kind`: `"tinytex"` or `"texlive"` | `progress`, then `ready` |
| `installAllPackages` | none | `progress`, then `ready` |
| `publishTemplate` | `projectId`; `action`: `"open"`, `"check"` or `"submit"`; `draft` for check/submit; `token` for submit | `templatePublish` events, optional `templatePreview`, then `templatePublish` with `done: true` |
| `templateThumbnail` | `requestId`: the publication request's id; PNG bytes as payload, or `error`: a rendering failure | resumes the pending publication; an unknown request id is refused |

`openProject` resolves `root` under the library root of the shared configuration ([library-format.md#shared-configuration](library-format.md#shared-configuration)) with the bridge's confinement: a path that leaves the library, also through a symlink, is refused with `path`. Every later `path`, `main` and `editedFile` of the project is resolved under that folder with the same rule. A `projectId` that is not open is refused with `project-id`.

`edit` changes only the helper's copy of the text. Build and edit requests never write into the library folder; a successful template publication saves its checked copy into My templates. A `.tex` `compile` builds the project's files from disk with the unsaved text of each edited path in their place. `mode: "preview"` runs one engine pass; `"full"` runs latexmk with the bibliography and every pass it needs. The page asks for `"full"` on save and after 2 s without typing. A save waits for an active preview of the same source revision; repeated requests coalesce into one full build. A source edit cancels the superseded build.

A `.typ` `compile` runs Typst 0.14.2 through the bundled WASM compiler, and `mode` makes no difference. Its fonts are in `typst-fonts/` and its packages in `typst-packages/` of the helper's data folder; the helper never reads or fills the user's own Typst folders.

### Helper to page

| `type` | Transport | Body |
|---|---|---|
| `ready` | native, socket | `protocol`: the helper's protocol version; `helperVersion`: non-empty string; `host`: `"helper"`, `"vscode"` or `"terminal"`, the program that answers (the standalone LabShelf Helper or a desktop app running the helper script); `tex`: `{ source, year?, complete }` |
| `session` | native | `port`: integer; `token`: string |
| `authed` | socket | none |
| `opened` | socket | `projectId`; `files`: string[] |
| `closed` | socket | `projectId` |
| `progress` | socket | `phase`: `"installing-tex"`, `"installing-package"`, `"building"` or `"updating"`; `message`: one line for the user; `fraction?`: 0 to 1 |
| `built` | socket | `status`: `"succeeded"`, `"failed"`, `"cancelled"`, `"toolchain-missing"` or `"needs-shell-escape"`; `problems`; `pdfSha256?` |
| `pages` | socket | `pdfSha256`; `pageCount`; `changed`: `{ index, offset, length }[]`; the payload |
| `templatePublish` | socket | `done`: boolean; optional `event`: a gallery `publish.*` event or `notice` |
| `templatePreview` | socket | the complete sample PDF as payload, at most 10 MiB; the browser answers with `templateThumbnail` |
| `error` | native, socket | `code`: non-empty string; `message`: string |

`tex.source` is `"none"`, `"tinytex"`, `"texlive"` or `"system"`; `year` is the TeX Live release year; `complete` is true when every package is installed, so a build never stops to install one.

Each entry of `problems` has `severity` (`"error"`, `"warning"` or `"info"`), `message` and `file` (a project path), and may have `hint`, `line` (from 1), `kind` (`"undefinedCitation"`, `"undefinedReference"` or `"overfull"`) and `subject` (the cite key or label). `pdfSha256` is present when `status` is `"succeeded"` and is the hash of the whole PDF the build produced.

`pages` carries only the pages whose content differs from the last `pages` the helper sent for that project on this socket; the first one after `openProject` carries every page. Each entry of `changed` is a page `index` from 0 and the `offset` and `length` in the payload of a standalone one-page PDF of that page. A page index at or past `pageCount` no longer exists.

A LaTeX build in `preview` mode can typeset the edited section alone on a cached preamble and swap its pages into `<base>-full.pdf`, the full build's PDF kept for display. This requires recorded empty-page boundaries with no pending floats at both ends (or the document end), single-column layout, and the same number of replacement pages. Otherwise it previews the whole document in one engine pass, retaining the cached preamble when supported. Editing an included chapter does not implicitly select include-only. A document preview invalidates section positions until a full build records them again. The transport describes the resulting complete PDF in every case.

The disposable `.lsstate` build cache records `command|filling page|source line|file|counter=value ...`, `P|record number|absolute page|page counter` at shipout, and `B|record number` for an empty-page boundary. Records are numbered from 1. Absence of `B` disallows page swapping at that boundary. This cache is not a library file or a transport message.

A successful build still sends its result and page count when no page changed. The helper reuses page hashes for identical PDF bytes; the browser retains the displayed PDF when its page count and pages are unchanged. Helper logs report working-copy sync, compilation and page-delivery time separately; browser logs report request latency and PDF assembly time.

A message the helper cannot accept gets an `error` reply with the request's `id` when it had one, and `code` set to the rejection: `malformed`, `version`, `unknown-type`, `invalid-field`, `path`, `project-id`, `stale`, `no-library` or `limit`. A handler that fails while working replies `io` (a project file could not be read) or `internal` (any other failure), with the failure in `message`.

`installTex` and `installAllPackages` end with an `error` instead of `ready` when they cannot finish: `texlive-rollover` when a managed full TeX Live is a year behind the repository, so the page asks before reinstalling it; `no-managed-tex` when `installAllPackages` finds no managed install; `tex-install-failed` for any other failure. A managed TinyTeX that falls behind is reinstalled with its packages without asking. A system TeX is never changed.

## Template publication

The gallery uses the [template publishing contract](templates.md#publish). `publishTemplate` resolves `projectId` under the configured library's `projects/` folder and refuses a project or main file that escapes the library. It reads the engine from `labshelf.yaml`, with `pdflatex` as the LaTeX default. It publishes saved files; unsaved editor text is excluded.

A draft contains `name`, `category`, `license` and `description`. `open` supplies the gallery's project and draft; `check` validates and builds without contacting GitHub. `submit` verifies the token's identity through GitHub, repeats every check on a temporary source snapshot, then submits those checked bytes and saves the same files and compiled previews into My templates. A failed local save reports that the pull request is open and the local copy failed. The helper keeps no access token on disk and never logs publication payloads.

Snapshots and their build output live under `publishing/` in the helper data folder and are deleted when the request finishes. The browser renders the first sample page to an 800-pixel-wide PNG with its bundled PDF.js. The helper validates that response against the catalog thumbnail limits. A thumbnail must answer the pending request within 60 seconds. `templateThumbnail` bypasses the ordered request queue so a publication waiting for rendering can continue. Closing the session cancels its outstanding rendering, build and network work.

## Paths

Every `path`, `main`, `editedFile` and entry of `files` is a relative POSIX path inside the project:

- at most 260 characters;
- no leading `/`, no `\`, no NUL and no drive letter (`C:`);
- no empty, `.` or `..` segment.

`projectId` follows the project id LabShelf derives from a title: lowercase ASCII letters and digits in runs joined by single hyphens. It names the project's folder in the helper's data folder.

## Limits

| Limit | Value |
|---|---|
| bytes in one socket message | 16 MiB |
| projects open at once | 8 |
| files in a project | 5000 |
| total size of a project's files | 500 MiB |
| entries in one `edit`'s `changes` | 10000 |

A message past a limit is rejected with `limit`; a socket message past 16 MiB closes the socket.

## Version

`PROTOCOL_VERSION` rises with every change to a message, a limit or the handshake. The page sends `hello` first; the helper answers `ready` with its `protocol`. When `protocol` is lower than the page's, the page asks to update the program `host` names (LabShelf Helper, or the VS Code extension or terminal app that runs the helper script); when it is higher, it shows "Update LabShelf". A message rejected for `version` reports the `v` it carried, so either side can tell which one is older. When the helper refuses the page's `hello` for `version`, its `error` reply carries the helper's `v`: the page treats a lower `v` as "Update LabShelf Helper" (the host is unknown, so it also names the VS Code extension and the terminal app) and a higher one as "Update LabShelf", and never shows the raw error. The standalone helper runs its self-update check after such a refusal, ignoring the once-a-day limit, and waits for it before it exits.

## Data folder

The helper keeps its data in one per-user folder:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/LabShelf Helper/` |
| Windows | `%LOCALAPPDATA%\LabShelf Helper\` |
| Linux | `$XDG_DATA_HOME/labshelf-helper/` |

```
projects/<projectId>/
  src/                  the copy TeX builds: the project's files from disk with the unsaved text in their place
  build/                latexmk's output folder, kept so latexmk reruns only what changed
bin/
biber-wasm/             biber's preloaded Perl tree, written once from the executable, named by its sha256
logs/
```

The managed TeX lives in the folder all LabShelf apps share: see [managed-tools.md](managed-tools.md). Template publication also writes its checked copy to the configured library’s My templates folder.

On macOS and Linux the data folder and `logs/` are `0o700` and log files `0o600`; the helper fixes the modes of the paths it writes. The standalone helper checks at start that its binary, the folder holding it (unless root owns that folder), its data folder and the `bin/` folder in it are not writable by group or others, and reports the path and mode on stderr and exits non-zero when one is. Every log line passes one redaction step that hides the session's socket token, `Bearer` tokens, `key=` and `token=` query values and URL fragments, and no message payload is logged, only its type, id and size.

## Registration

The standalone program registers itself: `labshelf-helper --register` writes the manifests of this host and of the bridge host ([bridge.md](bridge.md)) for every supported browser found for the user, and `--unregister` removes both. `--uninstall` also removes the bridge name and the helper's `bin/` folder in its data folder, and keeps the user's projects and the shared managed tools folder. The installers run `--register` and `--unregister`; the macOS installer has no uninstaller, so its closing page names `--uninstall`. The helper writes nothing outside the user's home.

The desktop apps register the same host name with their own launcher: VS Code with **LabShelf: Build LaTeX for the Browser** and the terminal app with `labshelf helper install`. Folders, manifests, allowed extension ids and which program wins are in [native-host.md](native-host.md).

## Self-update

Only the standalone binary updates itself. After it answers `hello`, it checks `latest.json` of the latest GitHub release at most once a day. After it refuses a `hello` for `version`, it checks regardless of that limit. The manifest is signed with Ed25519 and the helper rejects it unless the signature verifies against the public key built into it; the download must also match the asset's `sha256`. A newer version replaces the binary and runs from the next launch. A failed check is logged and never affects the session. A system TeX or a user's projects are not touched.

A helper run by VS Code or the terminal app never updates itself; it updates with that app.

## No shell-escape

The helper never runs TeX with shell-escape. A project that needs it ends with `built` `status: "needs-shell-escape"`. TeX runs with `-no-shell-escape` and with `openout_any` and `openin_any` set to `p`, so a source writes only inside its project and output folders. latexmk runs with `-norc`, so no `latexmkrc` runs: not the system's, the user's or the project's.

## Biber

On macOS and Linux, a helper that carries biber's WASM build sets latexmk's `$biber` to itself with `--biber --root <project folder>`. latexmk then starts biber as the helper, which runs the WASM build in its own process and starts no TeX executable. When the `.bcf`'s `<bcf:controlfile version>` differs from the version the WASM build reads, or a data source is remote, `--biber` runs the TeX's own `biber` with the same arguments. On Windows, and in a helper without the WASM build, latexmk runs the TeX's own `biber`.

`--biber` reads only the `.bcf` and its file data sources. It looks for each one from the main file's folder, then beside the `.bcf`, then through `kpsewhich`. It refuses a data source that resolves outside the project folder, the build folder and the TeX tree (`TEXMFROOT`). It writes the `.bbl` and the `.blg` beside the `.bcf`, prints biber's output, and exits with biber's code. A biber failure ends the build as `failed`, with the `ERROR` lines of the `.blg` as problems on the main file.
