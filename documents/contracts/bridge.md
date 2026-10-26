# Contract: bridge

Read when you change how the browser extension reaches the library folder through a desktop host, or a message between them.

The browser extension reaches the library folder through a desktop host program it starts with native messaging (`app.labshelf.bridge`). No port is opened and no account is involved. The extension and the hosts (the VS Code extension, the terminal app and the standalone LabShelf Helper) ship separately. The host serves the folder named by `libraryRoot` in the [shared configuration](library-format.md#shared-configuration). Registration, launchers and which program a browser starts are in [native-host.md](native-host.md).

The browser starts one host per connection. The host reads the library root once at start, exits when stdin closes and writes nothing but frames to stdout.

## Versioning

`protocol` is an integer in `hello`; any change to a message, a limit or the handshake raises it. A side that sees another value refuses the connection and tells the user to update LabShelf in the browser and on the desktop to the same release. The host answers that `hello` with a `protocol` error and stops. Before a successful `hello` it refuses every op with `protocol`. A `hello` succeeds when the versions match, even when it is answered with `noLibrary`.

## Framing

A frame is a 4-byte length in native byte order followed by UTF-8 JSON. Browsers drop host messages above a size limit, which sets the chunk size under [File transfer](#file-transfer). When a frame is too long or is not UTF-8 JSON, the host answers every message that arrived before it, sends one `{id: null, ok: false}` error with code `protocol`, stops reading and exits once its pending work is done.

## Paths

Every path is relative to the library root and `/`-separated; `""` names the root. The host refuses with `outsideLibrary` an absolute path, a drive-letter path, a `..` segment, a path through a symlink that leaves the root and a dangling symlink. Backslash is a separator too.

A segment that is a Windows device name (`con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`, with or without an extension, any case) is refused on every platform, because the library is shared across operating systems.

- Operations act on a symlink entry itself: `stat` reports it as neither file nor folder, and deleting removes the link. `deleteDir` never follows a symlink inside the folder it removes. Reading or writing through a symlink that leaves the root is refused.
- Writes are atomic through a temp file in `.research/tmp`. When that folder is on another volume the write fails with `io` rather than writing in place.
- LIMITATION: write, rename and delete resolve the entry's folder through the root's real path and check it again just before the final rename or unlink. A process that swaps a folder for a symlink between that check and the system call can still redirect the operation. Closing the window needs `openat`-style calls Node does not offer.
- Trust: the extension may read and write the whole library root, including `projects/`, whose `labshelf.yaml` holds commands the apps run. The desktop apps have the same trust.

## Messages

The host handles requests one at a time, in arrival order, and answers each with one response, except a write chunk. A message without a usable `id` is answered with `id: null`.

`setLibrary` lets a user who has only the standalone helper choose the library folder from the extension's options page. It is accepted only while the host serves no library, and it writes `libraryRoot` to the shared configuration, keeping the keys it does not own. Once a library is set, only a desktop app changes it.

## File transfer

File bytes travel as base64 chunks. Chunk data is canonical padded base64 (standard alphabet, `=` padding, zero bits under the padding), so every byte string has one encoding and a bad chunk fails when it arrives.

A write is `writeFile`, then `chunk` messages with the same `id`, then `commit` with the total byte count. Nothing is written before the commit. The host checks the size against the staged bytes, writes atomically, and drops the staged write on any error. Open writes and staged bytes per connection are limited.

## Events

The host watches the library folder and sends `changed` events with `paths` in debounced batches. They skip sync-tool noise and scratch folders ([code.md](../code.md#files)) and include the host's own writes. A batch that would exceed the browser's host-message limit is split in path order.
