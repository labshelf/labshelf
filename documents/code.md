# Code

Read when deciding where code belongs or changing an app, runtime or persistence boundary. Product and interaction decisions belong in [product.md](product.md) and [ui.md](ui.md).

The architecture supports connected research workflows across several hosts. Keep product behavior in shared domains so a fix or capability can serve each host without separate implementations. Platform differences belong at the integration boundary.

## Placement

- `packages/core/src/` owns domain behavior, file models, shared controllers and shared UI. Apps own composition, lifecycle and platform integration.
- Runtime-neutral code reaches the platform through ports. Domain code requiring Node, DOM, workers or webviews belongs in the domain's runtime folder (`node/`, `dom/`, `worker/`, `webview/`).
- App entry points construct adapters and connect domains. Keep platform-only behavior in the app, including injected browser scripts, browser leases and editor integration. Avoid moving wiring into core when it would introduce a dependency cycle.
- The CodeMirror source editor lives in `packages/core/src/writing/dom/sourceEditor/` (`@labshelf/core/sourceEditor`), with the runtime-neutral document authority and webview protocol in `packages/core/src/writing/` (`authority.ts`, `protocol.ts`) and the document-mode sync in `dom/sourceEditor/documentMode.ts`, and its Yjs binding and comment marks in `packages/core/src/collab/dom/` (`editorCollab.ts`, `editorComments.ts`). Hosts pass storage, share and comment-panel behavior in through `SourceEditorDeps`, including `commentSupport`, CodeMirror `extensions` (the VS Code page composes `createSelectionListener` and `createPeerCursors` through them); core never imports app storage or `libraryUi`.
- The drawing editor loads lazily as `@labshelf/core/drawingEditor` (`qmd/dom/drawingEditor/`, loaded through `loadDrawingEditor` of `qmd/dom/drawingEditor/index.ts`, the only file the rest of `qmd/dom` imports from the folder; it imports the editor only dynamically). It reaches MathJax only through `@labshelf/core/math` and parses its output with a ProseMirror-free parser that `qmd/dom` also uses, so the chunk stays small. Editor state, gestures and snapping are pure functions beside the DOM code; the PNG painter and SVG sanitizer sit in `qmd/drawing/dom/`.
- The VS Code LabShelf editor (`labshelf.sourceEditor`, a custom editor on the host's document) lives in `packages/vscode/src/writing/sourceEditor/`: the provider hosts the webview page, the bridges answer its requests from VS Code services, and `presenceBridge.ts` converts selections and peers between the webview's LF text and the document's line break; `collab/node/editors.ts` publishes the selection and lists peers per file.
- A note's view state (collapsed cells and sections, reading mode) goes through the injected `QmdViewStatePort`, keyed per note and item and normalised by `qmd/noteViewState.ts`. Hosts pass it as the `viewState` option of `startReader`, `mountSpace` and the library note mounts; the browser stores it in localStorage, and VS Code webviews in the webview `noteView` state key (`createWebviewNoteViewStore` over the single `acquireVsCodeApi()` result). The note bar (`qmd/dom/noteBar.ts`) and the cell menu (`qmd/dom/cellMenu.ts`) are shared editor UI; hosts supply only the note actions they can run.
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

## Math in notes

Plan: `documents/plans/math-in-prose/plan.yaml`. The reader has two halves, so the part most likely to change is testable without a kernel.

- **Reader.** `normaliseTex` (`qmd/item/normaliseTex.ts`) and `splitSteps` (`qmd/splitSteps.ts`) are pure TypeScript: `normaliseTex` rewrites known misreads (Euler's `e`, `\mathrm{d}x`, Leibniz and dot derivatives) and reports each rule applied; `splitSteps` splits one math into its top-level `=`/`&=` steps with TeX offsets. The Wolfram half is `mathDriver.wl` in `qmd/compute/node/`, loaded by `cellDriver.wl` and shipped beside it by every build: it parses to a held expression, evaluates only allow-listed symbols under `TimeConstrained` and `Quiet`, and answers `eval`, `numeric`, `solve` or `check` with a state, `readAs`, `rewrites` and `messages`.
- **Runtime.** `ICellRunner.runMath(request, signal?)` (`qmd/compute/cellRunner.ts`; `MathRequest`, `MathResult`, `MathOp`) runs on the same (language, note) queue as cells, so the note's variables apply. A superseded request is left to finish and its reply dropped; a timeout never kills the session.
- **Protocols.** Helper `evalMath`/`mathResult`, reader `evalMath`/`mathResult` (`reader/noteMessages.ts`), libraryUi `paper.evalMath`/`paper.mathResult` and Spaces `space.evalMath`/`space.mathResult`, each version-bumped; TeX is capped at 8 KiB. Hosts answer through `runMath` (`qmd/compute/node/cellSessions.ts`; Spaces: `evalSpaceMath` in `spaces/serveSpaces.ts`), the browser through `BrowserCellPorts.runMath` and the Helper.
- **Editor.** `qmd/editor/mathResult.ts` reads and writes the span as the atom node `math_result {tex, engine, source}`, byte for byte; a malformed span stays text ([qmd items](contracts/qmd-items.md#inline-results)). `deriveResultSource` in `qmd/item/` hashes the expression and the Mathematica cells above it. `QmdEditorOptions.onEvalMath` and `cellsAbove` (built by `evalMathBridge.ts` in `qmd/dom/` from each host's post/reply pair) are the only way the editor reaches a runner; without them it shows stored results and runs nothing.
- **DOM.** In `qmd/dom/`: `mathResultView.ts` (result node view, `=`/`\approx`/Solve trigger, out-of-date check), `mathCheckPlugin.ts` (step checks of edited math, 800 ms debounce, latest wins per node, cached by step and cells above, kept in plugin state and never written), `mathStepMarks.ts` (marks and gutter) and `mathHoverCard.ts` (the one shared card).

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
