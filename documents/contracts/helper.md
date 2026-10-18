# Contract: LabShelf Helper protocol

Read when you change a message between the browser extension and LabShelf Helper, a limit, the chunk rule or where the helper keeps its data.

LabShelf Helper is a native program that builds LaTeX projects for the browser extension. An extension page sends it the project's files and a build request; the helper runs latexmk with a managed or system TeX and sends back the problems and the PDF. The extension and the helper ship separately, so a user can run any extension version against any helper version, and every rule below holds across both. The protocol module in core (`writing/helper`) implements this document for both sides.

## Transport

The helper is a Chrome native messaging host named `dev.labshelf.helper`. Each frame is one UTF-8 JSON object preceded by its byte length as a 32-bit unsigned integer in native byte order, on the helper's stdin (page to helper) and stdout (helper to page). The helper writes only frames to stdout; its logs go to `logs/` in its data folder.

The browser allows frames of at most 1 MB from the helper. The chunk rule keeps every frame below that in both directions.

## Envelope

Every frame has the same envelope:

```json
{ "v": 1, "id": "7", "type": "build", "projectId": "thesis", "main": "main.tex", "engine": "pdflatex" }
```

| Key | Type | Notes |
|---|---|---|
| `v` | integer | the protocol version, `1`. A frame whose `v` differs is rejected |
| `id` | string | 1 to 64 characters, chosen by the page. A reply carries the `id` of the request it answers, and every `progress` frame of a request carries that request's `id` |
| `type` | string | one of the messages below for the frame's direction; any other value is rejected |

Keys a message does not define are dropped when the frame is read.

## Messages

### Page to helper

| `type` | Body | Reply |
|---|---|---|
| `hello` | `extensionVersion`: non-empty string | `ready` |
| `sync` | `projectId`; `files`: `{ path, sha256, size }[]`, the whole project as the page has it | `need` with the paths whose content the helper lacks; the helper deletes mirror files absent from `files` |
| `file` | `projectId`, `path`, `chunk` | `need` with no paths once the last chunk of every needed file has arrived |
| `delete` | `projectId`; `paths`: string[] | `need` with no paths |
| `build` | `projectId`; `main`: path of the main file; `engine`: `"pdflatex"`, `"xelatex"` or `"lualatex"` | `progress` frames, then `built`, then `pdf` frames when it succeeded |
| `cancel` | `projectId` | the running build ends with `built` `status: "cancelled"` |
| `installTex` | `kind`: `"tinytex"` or `"texlive"` | `progress` frames, then `ready` |
| `installAllPackages` | none | `progress` frames, then `ready` |

`sha256` is the lowercase hex SHA-256 of the file; `size` is its length in bytes. A `sync` lists each path once. Tectonic is not an engine of the helper; a project set to Tectonic builds elsewhere.

### Helper to page

| `type` | Body |
|---|---|
| `ready` | `protocol`: the helper's protocol version; `helperVersion`: non-empty string; `tex`: `{ source, year?, complete }` |
| `need` | `paths`: string[] |
| `progress` | `phase`: `"syncing"`, `"installing-tex"`, `"installing-package"`, `"building"` or `"updating"`; `message`: one line for the user; `fraction?`: 0 to 1 |
| `built` | `status`: `"succeeded"`, `"failed"`, `"cancelled"`, `"toolchain-missing"` or `"needs-shell-escape"`; `problems`; `pdfSha256?` |
| `pdf` | `chunk` |
| `error` | `code`: non-empty string; `message`: string |

`tex.source` is `"none"`, `"tinytex"`, `"texlive"` or `"system"`; `year` is the TeX Live release year; `complete` is true when every package is installed, so a build never stops to install one.

Each entry of `problems` has `severity` (`"error"`, `"warning"` or `"info"`), `message` and `file` (a project path), and may have `hint`, `line` (from 1), `kind` (`"undefinedCitation"`, `"undefinedReference"` or `"overfull"`) and `subject` (the cite key or label). `pdfSha256` is present when `status` is `"succeeded"` and is the hash of the bytes the `pdf` chunks carry.

A frame the helper cannot accept gets an `error` reply with the request's `id` when it had one, and `code` set to the rejection: `malformed`, `version`, `unknown-type`, `invalid-field`, `path`, `project-id` or `limit`.

`installTex` and `installAllPackages` end with an `error` instead of `ready` when they cannot finish: `texlive-rollover` when a managed full TeX Live is a year behind the repository, so the page asks before reinstalling it; `no-managed-tex` when `installAllPackages` finds no managed install; `tex-install-failed` for any other failure. A managed TinyTeX that falls behind is reinstalled with its packages without asking. A system TeX is never changed.

## Chunks

File contents and the PDF travel as chunks: `{ index, count, data }`. `data` is canonical base64 of at most 512 KiB of raw bytes, and the same rule holds in both directions. `count` is the number of chunks of the stream, at least 1; an empty file is one chunk with empty `data`. Chunks of one stream arrive in order from `index` 0 with the same `count`; a gap, a repeated index or a changed `count` rejects the stream.

## Paths

Every `path`, `main` and entry of `paths` is a relative POSIX path inside the project:

- at most 260 characters;
- no leading `/`, no `\`, no NUL and no drive letter (`C:`);
- no empty, `.` or `..` segment.

`projectId` follows the project id LabShelf derives from a title: lowercase ASCII letters and digits in runs joined by single hyphens. It names the project's folder in the helper's data folder.

## Limits

| Limit | Value |
|---|---|
| files in a `sync`, paths in a `delete` or `need` | 5000 |
| total `size` declared by a `sync` | 500 MiB |
| raw bytes in one chunk | 512 KiB |
| chunks in one stream | 1000 |

A frame past a limit is rejected with `limit`.

## Version

`PROTOCOL_VERSION` rises with every change to a message, a limit or the chunk rule. The page sends `hello` first; the helper answers `ready` with its `protocol`. When `protocol` is lower than the page's, the page shows "Update LabShelf Helper"; when it is higher, it shows "Update LabShelf". A frame rejected for `version` reports the `v` it carried, so either side can tell which one is older.

## Data folder

The helper keeps its data in one per-user folder:

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/LabShelf Helper/` |
| Windows | `%LOCALAPPDATA%\LabShelf Helper\` |
| Linux | `$XDG_DATA_HOME/labshelf-helper/` |

```
projects/<projectId>/   a source mirror plus its build folder, so latexmk reruns only what changed
tex/                    the managed TeX
bin/
logs/
```

The helper writes nowhere else.

## No shell-escape

The helper never runs TeX with shell-escape. A project that needs it ends with `built` `status: "needs-shell-escape"`.
