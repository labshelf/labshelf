# Code

Read when deciding where code belongs or changing an app, runtime or persistence boundary. Product and interaction decisions belong in [product.md](product.md) and [ui.md](ui.md).

The architecture supports connected research workflows across several hosts. Keep product behavior in shared domains so a fix or capability can serve each host without separate implementations. Platform differences belong at the integration boundary.

## Placement

- `packages/core/src/` owns domain behavior, file models, shared controllers and shared UI. Apps own composition, lifecycle and platform integration.
- Runtime-neutral code reaches the platform through ports. Domain code requiring Node, DOM, workers or webviews belongs in the domain's runtime folder (`node/`, `dom/`, `worker/`, `webview/`).
- App entry points construct adapters and connect domains. Keep platform-only behavior in the app, including injected browser scripts, browser leases and editor integration. Avoid moving wiring into core when it would introduce a dependency cycle.
- The CodeMirror source editor lives in `packages/core/src/writing/dom/sourceEditor/` (`@labshelf/core/sourceEditor`), with the runtime-neutral document authority and webview protocol in `packages/core/src/writing/sourceEditor/` (`authority.ts`, `protocol.ts`) and the document-mode sync in `dom/sourceEditor/documentMode.ts`, and its Yjs binding and comment marks in `packages/core/src/collab/dom/` (`editorCollab.ts`, `editorComments.ts`). Hosts pass storage, share and comment-panel behavior in through `SourceEditorDeps`, including `commentSupport`; core never imports app storage or `libraryUi`.
- Share behavior and components that hosts actually share. Inspect nearby domain APIs before adding a new abstraction; do not merge similar-looking code whose host semantics differ.

## Modules

- A subfolder below a domain is a package: `index.ts` exposes its API; other files are private. Runtime folders are part of their enclosing package. `pnpm lint:modules` enforces boundaries.
- A file holds one concept, up to 400 lines. Extend the file that owns the concept before creating another; a file under 80 lines used only by one file in its folder belongs in that file.
- Create a subfolder when a cohesive group needs a small public API and hides implementation from its callers. Place it where its users meet, without mutual dependencies between parent and child. File count alone does not justify a folder.
- Reuse core modules for generic operations. Inspect the relevant `index.ts` before writing helpers for async work, encoding, errors, events, files, guards, hashing, JSON, paths, text, time or URLs. `pnpm lint:modules` also checks private copies of shared exports.

## Contracts

- [contracts/](contracts/) specifies persistent files and links, and protocols between programs that ship separately. Read only the contracts affected by the task.
- Types and tests specify boundaries inside one build, such as a shared UI and its host. Do not repeat their message catalogs or implementation algorithms in a contract.
- Update a contract with the boundary it governs. Follow its versioning rules. Do not add migrations or legacy readers unless the task requires them; preserving unknown content in the current format is a separate obligation.
- A contract records shapes, limits and invariants that would be missed by reading only one side. Product intent, screen layout and future ideas belong elsewhere.

## Files

These rules apply to library, project and device-state files unless a contract specifies an exception. A library can change through another app, a text editor or a sync tool at any time.

- Write atomically through a temporary file and rename. Reread before a content-dependent write and guard against intervening changes where the contract requires it.
- Change only owned content. Preserve unknown keys and unreadable entries, key order and YAML comments according to the format. Respect byte-preserving edits for [qmd items](contracts/qmd-items.md).
- Handle malformed and partially synced files without crashing. Use format-specific defaults or read-only states, log invalid entries and report failures. Never overwrite a file whose top-level structure cannot be parsed.
- Use each format's canonical serialization, so hosts do not create conflicts through formatting alone. Structured files use stable key order, two-space indentation and a final newline unless their contract says otherwise. Canonical serialization does not override preservation rules.
- Keep device-specific paths, secrets, caches and state outside synced content, in the locations specified by the [library format](contracts/library-format.md#device-local-files). Treat synced content as shared state.
- Process file events in debounced batches. Ignore sync-tool noise and scratch files as defined by the relevant watcher and format.

## Messages

- Validate input from pages, webviews and other processes with the shared protocol parser. Reject an invalid message whole. Hosts enforce permissions and path boundaries independently of visible controls.
- A shared UI owns its prompts, menus and confirmations; the host performs operations through ports and returns results, progress and notices. Native pickers remain the host's responsibility.
- Use one shared controller for a surface across hosts. Hosts own transport and lifecycle, and buffer outbound state until the UI reports `ready`.
- Keep webview CSP and resource roots compatible with lazy chunks: nonce and `cspSource` for scripts, and `webviewChunksDir` in `localResourceRoots`. Open external URLs only through `isSafeExternalUrl`.
- Log an operation failure with its context and present an actionable notice. Never log keys, tokens, invites or message payloads.
- Version protocols between separately shipped programs according to their contracts. Refuse incompatible peers and explain which program needs updating.
