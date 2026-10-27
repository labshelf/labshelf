# Code

Read when you decide where code goes or change what crosses an app, process or file boundary.

## Placement

- Code that two apps need, or plausibly will, goes in core, including UI that two apps show. An app holds only its wiring and the code only its platform can run.
- Runtime-neutral core reaches the platform only through ports that each app implements. Core code that needs Node or the DOM sits in a `node/` or `dom/` folder of its domain.
- Only an app's entry points build adapters: `extension.ts` in VS Code, `compositionRoot.ts` in the terminal, and the background worker and each page in the browser.

## Modules

A subfolder below a domain is a package: its `index.ts` is the public API and the rest is private to the folder. `pnpm lint:modules` checks it.

- A file holds one concept, up to 400 lines, with as many functions as the concept needs. Add code to the file of its concept before creating a file; a file under 80 lines used by a single file in its folder belongs in that file.
- A subfolder exists only when it hides something (a file only its own files use), its files work together, it sits directly under the folder where its users meet, and it does not depend on the files of its parent while the parent depends on it.
- A subfolder appears when a group of files that work together is reached by the rest of the folder through one or two of them; the lint warns when it sees such a group. The number of files in a folder is never a reason to create one.
- `node/`, `dom/`, `worker/` and `webview/` are runtime folders, part of the enclosing package.

## Shared modules

Generic helpers live in a core module named after their subject and are imported, never rewritten in a private copy; `pnpm lint:modules` fails a private function named like one of their exports. Read the module's `index.ts` before writing a helper.

- `packages/core/src/async`: debouncers, sleep, deadlines.
- `packages/core/src/encoding`: base64, base64url, hex (strict decode), byte comparison and joining, random bytes and random hex, fixed-length key decoding.
- `packages/core/src/errors`: formatError, describeError, toError, errorCode, isAbortError for a thrown unknown.
- `packages/core/src/events`: listener registry (createListeners).
- `packages/core/src/guards`: narrowing predicates over unknown for parsers.
- `packages/core/src/hash`: SHA-256 hex of bytes or text.
- `packages/core/src/json`: parseJsonObject, JSON text to a plain object or undefined.
- `packages/core/src/path`: path math over the `PathOps` port, `LibraryPath` and `ProjectPath`.
- `packages/core/src/url`: parse a URL without throwing, host and origin of a URL string.
- `packages/core/src/time`: calendar days, relative and display dates.

## Contracts

- `documents/contracts/` holds only what both sides cannot read from one codebase: files that outlive the code (in the library, in the user's text, on another device) and protocols between programs that ship separately (browser extension, LabShelf Helper, relay Worker, Community catalog). A boundary inside one build, such as a UI and its host, is specified by its TypeScript types and tests, not a contract.
- A contract states shapes, limits, versions and the invariants a reader of one side would miss. It does not restate a type, describe UI or narrate an algorithm whose only implementation is in core.
- A change to a boundary changes its contract in the same change. There are no existing libraries to preserve: when a file format or folder layout changes, the code reads and writes only the new one, with no conversion or fallback for the old.

## Files

These hold for every file LabShelf writes in a library, a project or the device state, unless its contract says otherwise.

- Writes are atomic: a temp file renamed into place, so a sync tool never uploads half a file. A write that depends on the file's content reads it again just before writing.
- A rewrite changes only the keys it owns and preserves unknown keys, key order and, in YAML, comments. Entries it cannot read are kept unchanged.
- Reading never throws on a hand-edited or half-synced file. Invalid fields fall back to defaults and invalid entries are hidden and logged. A file that does not parse at the top level is reported and never overwritten.
- Every app writes the same bytes for the same state (key order, two-space indent, final newline), so two apps never cause a sync conflict by formatting alone.
- What belongs to one device lives outside the library folder, under the library's device-local folder ([library-format.md](contracts/library-format.md#device-local-files)). Everything inside the library is shared state another device may change at any time.
- File changes are handled in debounced batches, never file by file. Sync tools' temporary names and metadata files and LabShelf's scratch folders trigger nothing.

## Messages

- Input from another process, a webview or a page is untrusted: it passes the shared parser for its protocol, and a message that fails is dropped whole, never half-applied. Hiding a control is not authorization; the host checks every call.
- External URLs open only through `isSafeExternalUrl` (`http:`, `https:`, `mailto:`).
- A UI in core owns everything on screen, including prompts, menus and confirmations. Its host does the work and answers with a result, a progress or a notice; only native pickers the platform requires are the host's.
- One controller in core answers a surface's messages for every host. A host implements ports and its own lifecycle, and buffers what it sends before the UI reports `ready`.
- A handler that fails is logged with what it was doing and shown to the user as a notice.
- Every protocol between programs that ship separately carries a version. A change to a message, a limit or the handshake raises it, and a side that sees an incompatible version refuses and tells the user which program to update.
- Logs never hold keys, tokens, invites or message payloads.
