# Contract: bridge

The browser extension reaches the library folder through a desktop host program it starts with Native Messaging. No port is opened and no account is involved. The host serves the folder named by `libraryRoot` in the shared configuration ([library-format.md#shared-configuration](library-format.md#shared-configuration)) under the rules of [sync.md](sync.md).

## Host

- The host name is `app.labshelf.bridge`.
- The browser starts one host per connection. The host reads the library root once at start and exits when its stdin closes.
- The host logs to `bridge.log` in the library's device-local logs folder ([library-format.md#device-local-files](library-format.md#device-local-files)). With no library configured, it logs to `logs/bridge.log` in the device state folder (`$XDG_STATE_HOME/labshelf`, else `~/Library/Application Support/labshelf` on macOS and `~/.local/state/labshelf` elsewhere). It never writes anything but frames to stdout.
- The apps install the host on the user's request (VS Code **Connect the Browser**, `labshelf bridge install`), and the standalone LabShelf Helper registers it with its own host. The launcher, manifests and registration follow [native-host.md](native-host.md).

## Framing

Every message is a 4-byte length in native byte order (little-endian on every platform the browsers ship on), followed by that many bytes of UTF-8 JSON. A host message is at most 1 MB; a browser message is at most 64 MB. When a frame is too long or is not UTF-8 JSON, the host answers every message that arrived before it, then sends one `{id: null, ok: false, error}` with code `protocol`, stops reading and exits once its pending answers and writes are done.

## Versioning

`protocol` is an integer, currently `2`. The browser sends it in `hello`. A side that sees another value refuses the connection and tells the user to update LabShelf in the browser and on the desktop to the same release: the host answers that `hello` with a `protocol` error and stops. The host refuses every op before a successful `hello` with a `protocol` error. A `hello` succeeds when the versions match, even when it is answered with `noLibrary`.

## Paths

Every path is relative to the library root, `/`-separated; `""` names the root. The host refuses with `outsideLibrary` an absolute path, a drive-letter path, a path with a `..` segment, a path through a symlink that leaves the root, and a dangling symlink.

Backslash is a path separator too. A segment that is a Windows device name (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`, with or without an extension, any case) is refused with `outsideLibrary` on every platform, because the library is shared across operating systems.

`stat`, `listDir` and `deleteFile` act on a symlink entry itself: `stat` reports it as neither a file nor a folder, and `deleteFile` and `deleteDir` remove the link, whether it points inside, outside or nowhere. `deleteDir` never follows a symlink inside the folder it removes. Reading or writing through a symlink that leaves the root is refused. `rename` overwrites an existing target. Writes are always atomic, through a temp file in `.research/tmp`; when that folder is on another volume the write fails with `io` rather than writing in place.

Write, rename and delete resolve the entry's folder through the root's real path and check that folder again just before the final rename or unlink. A process that swaps a folder for a symlink between that check and the system call can still redirect the operation; closing that window needs `openat`-style calls Node does not offer.

The extension is trusted with reading and writing the whole library root, including `projects/`, whose `labshelf.yaml` holds commands the apps run. This is the same trust the desktop apps have.

## Messages

A request is `{id, op, …}` with an integer `id` chosen by the browser. The host answers each request, except a write chunk, with one response: `{id, ok: true, result}` or `{id, ok: false, error: {code, message}}`. A message without a usable `id` is answered with `id: null`. The host handles requests one at a time, in arrival order.

| `op` | Fields | `result` |
|---|---|---|
| `hello` | `protocol` | `{protocol, libraryRoot, paperCount}` |
| `setLibrary` | `root`: an absolute path to an existing folder | `{libraryRoot, paperCount}`; only while the host serves no library, refused with `protocol` otherwise |
| `listDir` | `path` | `{names}`; `[]` for a missing folder |
| `stat` | `path` | `{stat: {isFile, isDirectory, mtimeMs, size} \| null}`; a symlink is neither file nor folder |
| `readFile` | `path` | chunks, then `{done: true, size}` |
| `writeFile` | `path` | none until `commit` |
| `chunk` | `data` | none |
| `commit` | `size` | `{size}`; refused when `size` differs from the staged byte count |
| `deleteFile` | `path` | `{}`; a missing file is not an error |
| `deleteDir` | `path` | `{}`; removes the folder and everything in it; a missing folder is not an error; refused with `outsideLibrary` for the root and with `io` for a file |
| `ensureDir` | `path` | `{}`; creates parents |
| `rename` | `from`, `to` | `{}`; creates the parents of `to` |

`paperCount` counts the folders at any depth in `papers/` that hold a `metadata.yaml`.

`setLibrary` lets a user who has only the standalone LabShelf Helper choose the library folder from the extension's options page; it may follow a `hello` answered with `noLibrary`. The host writes `libraryRoot` to the shared configuration ([library-format.md#shared-configuration](library-format.md#shared-configuration)), keeping the keys it does not own, and serves that folder from then on. Once a library is set, only a desktop app changes it.

Error codes:

| `code` | Meaning |
|---|---|
| `notFound` | the path does not exist |
| `outsideLibrary` | the path leaves the library root |
| `noLibrary` | no library root is configured, or the folder is not reachable |
| `protocol` | a malformed message, an unknown op, a chunk or commit without an open write, a `writeFile` whose `id` is already open, chunk data that is not canonical base64, a commit `size` mismatch, a staging limit, or another protocol version |
| `io` | any other file-system failure; `message` says which |

## File transfer

File bytes travel as base64 chunks of at most 512 KB of raw bytes, so a host message stays under 1 MB. Chunk data is canonical padded base64: standard alphabet, `=` padding, and zero bits under the padding, so every byte string has one encoding.

- `readFile`: the host sends `{id, chunk}` messages in order, then the response `{id, ok: true, result: {done: true, size}}`.
- `writeFile`: the browser sends `{id, op: "writeFile", path}`, then `{id, op: "chunk", data}` messages with the same `id`, then `{id, op: "commit", size}` with the total byte count. The host decodes each chunk as it arrives, so bad data fails at that chunk. It writes nothing before the commit, checks `size` against the staged bytes, then writes the file atomically through `.research/tmp/`. Any error answers the `id` and drops the staged write.
- Limits per connection: at most 8 open writes and 256 MB of staged bytes across them. A `writeFile` past the first limit, or a chunk past the second, fails with `protocol`; committed and dropped writes free their share.

## Events

The host watches the library folder and sends `{event: "changed", paths}` in debounced batches. `paths` are relative and `/`-separated, skip the noise listed in [sync.md#partial-writes-and-noise](sync.md#partial-writes-and-noise), and include the host's own writes. A batch whose event would exceed the 1 MB host message limit is split into several `changed` events, in path order.
