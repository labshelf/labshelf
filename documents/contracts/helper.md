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
- the upgrade asks for an extension or a text subprotocol.

Socket frames are binary WebSocket messages (RFC 6455, no extensions, text frames refused). Each message is a 4-byte little-endian length of a UTF-8 JSON envelope, the envelope, then the raw payload bytes the envelope describes (no base64). The helper writes only native frames to stdout; its logs go to `logs/` in its data folder.

Firefox upgrades `ws://` to `wss://` under the CSP directive `upgrade-insecure-requests`, so the Firefox manifest's `extension_pages` CSP does not carry it.

## Envelope

Every message has the same envelope:

```json
{ "v": 2, "id": "7", "type": "compile", "projectId": "thesis", "main": "main.tex", "mode": "preview" }
```

| Key | Type | Notes |
|---|---|---|
| `v` | integer | the protocol version, `2`. A message whose `v` differs is rejected |
| `id` | string | 1 to 64 characters, chosen by the page. A reply carries the `id` of the request it answers, and every `progress` message of a request carries that request's `id`. Messages the helper sends unasked (`lsp`) have no `id` |
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
| `closeProject` | `projectId` | `closed`; the helper drops the project's unsaved text and stops its language server |
| `edit` | `projectId`, `path`, `version`: integer from 1; either `text`, the whole file, or `changes`: `{ from, to, insert }[]`, non-overlapping ranges of UTF-16 offsets in the text of `version - 1` | none; `error` `stale` when `changes` do not apply to the helper's version, and the page then sends `text` |
| `save` | `projectId`, `path` | none; the page wrote the file through its own storage, and the helper drops its unsaved text for it and reads the file from disk again |
| `compile` | `projectId`; `main`; `mode`: `"preview"` or `"full"`; `engine?`: `"pdflatex"`, `"xelatex"` or `"lualatex"` for a `.tex` main; `editedFile?` | `progress`, then `built`, then `pages` when it succeeded |
| `cancel` | `projectId` | the running build ends with `built` `status: "cancelled"` |
| `lsp` | `projectId`; `payload`: one JSON-RPC message for the project's Typst language server | none; the server's messages come back as `lsp` |
| `installTex` | `kind`: `"tinytex"` or `"texlive"` | `progress`, then `ready` |
| `installAllPackages` | none | `progress`, then `ready` |

`openProject` resolves `root` under the library root of the shared configuration ([library-format.md#shared-configuration](library-format.md#shared-configuration)) with the bridge's confinement: a path that leaves the library, also through a symlink, is refused with `path`. Every later `path`, `main` and `editedFile` of the project is resolved under that folder with the same rule. A `projectId` that is not open is refused with `project-id`.

`edit` changes only the helper's copy of the text. The helper never writes into the library folder. A `.tex` `compile` builds the project's files from disk with the unsaved text of each edited path in their place. `mode: "preview"` runs one engine pass; `"full"` runs latexmk with the bibliography and every pass it needs. The page asks for `"full"` on save and after 2 s without typing.

A Typst project runs on the managed Tinymist ([managed-tools.md#tinymist](managed-tools.md#tinymist)), installed on first use with `progress` phase `"installing-tinymist"`. The helper starts one Tinymist per open Typst project, on its first `lsp` or `compile`, with the project's working copy as root, and stops it on `closeProject` or when the socket closes. Every `edit` of the project reaches the server as `textDocument/didChange`, so completion and diagnostics see unsaved text. Document URIs in `lsp` payloads are `labshelf:/<path>` with a project path, each segment percent-encoded; the helper maps them to and from the files of the working copy, so the page never sees a path on the computer. The helper refuses a page `lsp` message whose method is `workspace/executeCommand` or `workspace/didChangeConfiguration`, or that holds a raw `file:` URI or a URI that leaves the project: a request gets a JSON-RPC error reply (`-32600`), a notification is dropped; a server `workspace/applyEdit` that names a file outside the project is dropped and answered as not applied. Tinymist runs, for the language server and for `compile`, with a minimal environment (`PATH`, `LANG`, the temporary folder, `HOME` set to the helper's data folder) and with Typst's package cache and local packages in `typst-packages/` of that folder, so it never reads or fills the user's own caches; it still sees the system fonts and the user's font folders. The page's initialization options and configuration are not passed to Tinymist: the helper answers the server's configuration requests itself. A `.typ` `compile` exports the PDF through Tinymist; `mode` makes no difference.

### Helper to page

| `type` | Transport | Body |
|---|---|---|
| `ready` | native, socket | `protocol`: the helper's protocol version; `helperVersion`: non-empty string; `host`: `"helper"`, `"vscode"` or `"terminal"`, the program that answers (the standalone LabShelf Helper or a desktop app running the helper script); `tex`: `{ source, year?, complete }` |
| `session` | native | `port`: integer; `token`: string |
| `authed` | socket | none |
| `opened` | socket | `projectId`; `files`: string[] |
| `closed` | socket | `projectId` |
| `progress` | socket | `phase`: `"installing-tex"`, `"installing-package"`, `"installing-tinymist"`, `"building"` or `"updating"`; `message`: one line for the user; `fraction?`: 0 to 1 |
| `built` | socket | `status`: `"succeeded"`, `"failed"`, `"cancelled"`, `"toolchain-missing"` or `"needs-shell-escape"`; `problems`; `pdfSha256?` |
| `pages` | socket | `pdfSha256`; `pageCount`; `changed`: `{ index, offset, length }[]`; the payload |
| `lsp` | socket | `projectId`; `payload` |
| `error` | native, socket | `code`: non-empty string; `message`: string |

`tex.source` is `"none"`, `"tinytex"`, `"texlive"` or `"system"`; `year` is the TeX Live release year; `complete` is true when every package is installed, so a build never stops to install one.

Each entry of `problems` has `severity` (`"error"`, `"warning"` or `"info"`), `message` and `file` (a project path), and may have `hint`, `line` (from 1), `kind` (`"undefinedCitation"`, `"undefinedReference"` or `"overfull"`) and `subject` (the cite key or label). `pdfSha256` is present when `status` is `"succeeded"` and is the hash of the whole PDF the build produced.

`pages` carries only the pages whose content differs from the last `pages` the helper sent for that project on this socket; the first one after `openProject` carries every page. Each entry of `changed` is a page `index` from 0 and the `offset` and `length` in the payload of a standalone one-page PDF of that page. A page index at or past `pageCount` no longer exists.

A message the helper cannot accept gets an `error` reply with the request's `id` when it had one, and `code` set to the rejection: `malformed`, `version`, `unknown-type`, `invalid-field`, `path`, `project-id`, `stale`, `no-library` or `limit`. A handler that fails while working replies `io` (a project file could not be read) or `internal` (any other failure), with the failure in `message`.

`installTex` and `installAllPackages` end with an `error` instead of `ready` when they cannot finish: `texlive-rollover` when a managed full TeX Live is a year behind the repository, so the page asks before reinstalling it; `no-managed-tex` when `installAllPackages` finds no managed install; `tex-install-failed` for any other failure. A managed TinyTeX that falls behind is reinstalled with its packages without asking. A system TeX is never changed.

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

`PROTOCOL_VERSION` rises with every change to a message, a limit or the handshake. The page sends `hello` first; the helper answers `ready` with its `protocol`. When `protocol` is lower than the page's, the page asks to update the program `host` names (LabShelf Helper, or the VS Code extension or terminal app that runs the helper script); when it is higher, it shows "Update LabShelf". A message rejected for `version` reports the `v` it carried, so either side can tell which one is older.

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
logs/
```

The managed TeX lives in the folder all LabShelf apps share: see [managed-tools.md](managed-tools.md). The helper writes nowhere else.

On macOS and Linux the data folder and `logs/` are `0o700` and log files `0o600`; the helper fixes the modes of the paths it writes. The standalone helper checks at start that its binary, the folder holding it (unless root owns that folder), its data folder and the `bin/` folder in it are not writable by group or others, and reports the path and mode on stderr and exits non-zero when one is. Every log line passes one redaction step that hides the session's socket token, `Bearer` tokens, `key=` and `token=` query values and URL fragments, and no message payload is logged, only its type, id and size.

## Registration

The standalone program registers itself: `labshelf-helper --register` writes the manifests of this host and of the bridge host ([bridge.md](bridge.md)) for every supported browser found for the user, and `--unregister` removes both. `--uninstall` also removes the bridge name and the helper's `bin/` folder in its data folder, and keeps the user's projects and the shared managed tools folder. The installers run `--register` and `--unregister`; the macOS installer has no uninstaller, so its closing page names `--uninstall`. The helper writes nothing outside the user's home.

The desktop apps register the same host name with their own launcher: VS Code with **LabShelf: Build LaTeX for the Browser** and the terminal app with `labshelf helper install`. Folders, manifests, allowed extension ids and which program wins are in [native-host.md](native-host.md).

## Self-update

Only the standalone binary updates itself. After it answers `hello`, it checks `latest.json` of the latest GitHub release at most once a day. The manifest is signed with Ed25519 and the helper rejects it unless the signature verifies against the public key built into it; the download must also match the asset's `sha256`. A newer version replaces the binary and runs from the next launch. A failed check is logged and never affects the session. A system TeX or a user's projects are not touched.

A helper run by VS Code or the terminal app never updates itself; it updates with that app.

## No shell-escape

The helper never runs TeX with shell-escape. A project that needs it ends with `built` `status: "needs-shell-escape"`. TeX runs with `-no-shell-escape` and with `openout_any` and `openin_any` set to `p`, so a source writes only inside its project and output folders. latexmk runs with `-norc`, so no `latexmkrc` runs: not the system's, the user's or the project's.
