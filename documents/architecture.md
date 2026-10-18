# Architecture

Read when you add, move or split code, or add a port, an adapter or a UI piece.

## Packages

```
packages/
  core/       @labshelf/core      everything more than one app can use
  vscode/     @labshelf/vscode    VS Code extension: wiring and VS Code-only code
  browser/    @labshelf/browser   Chrome/Firefox MV3 extension: wiring and browser-only code
  terminal/   @labshelf/terminal  `labshelf` TUI and CLI: wiring and terminal-only code
website/    @labshelf/website   public site about LabShelf; not part of the product
```

Dependencies point one way: each app depends on `core`, and nothing depends on an app. Apps never import each other. The website may mount core's library UI and reader through their host contracts, with an in-page host over the demo library in `website/demo-library/`. It never imports an app.

## What an app contains

An app contains only two kinds of code:

1. **Wiring.** The composition root that builds core services with the app's adapters, registration of commands, views and pages, and the translation of UI events into core calls.
2. **Code that cannot exist anywhere else:**
   - VS Code: `vscode` API usage (activation, commands, tree views, webview panels, `SecretStorage`, settings).
   - Browser: manifests, the background service worker, content scripts, `chrome.*`/`browser.*` APIs, IndexedDB adapters, the popup and options pages, the helper-tab PDF fetch.
   - Terminal: raw TTY input and screen, kitty/iTerm2 images, CLI argument parsing, keychain token storage, the system clipboard, opener and trash. The terminal package also builds the LabShelf Helper entry, the native host the browser extension builds LaTeX through.

Anything else that two apps need moves to `core`, even if only one app uses it today but another plausibly will.

## Core

Core is organised by domain. Inside a domain, code is split by the runtime it needs:

```
core/src/<domain>/
  *.ts        runtime-neutral: ES2022 plus fetch, URL, TextEncoder, crypto.subtle. No node:*, no DOM.
  node/       may use node:* (consumed by vscode and terminal)
  dom/        may use the DOM (consumed by VS Code webviews and browser pages)
```

One folder runs in a runtime of its own: `relay/worker/` is the owner's Cloudflare Worker ([contracts/relay.md](contracts/relay.md)). It imports only runtime-neutral core code, declares the few Workers APIs it uses itself, and compiles under the neutral tsconfig; `tools/relayWorker/bundleRelayWorker.mjs` bundles it into the one script LabShelf uploads.

The package exposes three entry points that match these runtimes: `@labshelf/core`, `@labshelf/core/node` and `@labshelf/core/dom`. A fourth, `@labshelf/core/math`, renders LaTeX math to SVG with MathJax; it stays out of the root barrel because MathJax is large and has import-time side effects, so only the code that renders math pulls it into a bundle. `@labshelf/core/typst` (runtime-neutral) and `@labshelf/core/typst/node` compile Typst to PDF with typst.ts and stay out of the other entries for the same reason; typst.ts is an ES module loaded with a dynamic `import()`, so core's tests run under `node --experimental-vm-modules`. Stylesheets are exported as `@labshelf/core/styles/*`. Separate tsconfigs (neutral code without the DOM and Node libs) and an import-boundary lint make a violation fail the build.

Domains:

| Domain | Owns |
|---|---|
| `model/` | shared types and their runtime value lists: paper record, statuses, annotations, themes, colours, log entry |
| `ports/` | the interfaces apps implement: file system, local file system, the library file system that mutations write through (adds rename, trash and mkdir), lock store, sidecar port, research database, logger, log sink |
| `library/` | the library format ([contracts/library-format.md](contracts/library-format.md)): layout paths, `metadata.yaml` ⇄ record, cite keys, tags, folder names, library mutations (import, move, rename, trash, update fields, text-layer verdicts; all three apps call them and add only host glue), shared config; `scan/` reads `papers/` into a library scan; `model/` has the folder tree, folder navigation, the in-memory store with sort and filter, snapshots and the reindex diff; `search/` has the query language, matching and fuzzy matching; `format/` has the author, venue, link, size and relative-time formatters; `externalChange/` has the filter that ignores the library's own writes; `identity/` has cite keys, tags, folder names and title keys; `node/` has the Node file system, atomic writes and the shared config file |
| `import/` | everything that turns an input into a paper: identifier detection, PDF text and metadata extraction, metadata registries (CrossRef, arXiv, Semantic Scholar…), resolution and merge, landing-page parsing, the PDF finder (concurrent lookups, then ranked, host-paced downloads), BibTeX; `node/` has the pdfjs opener, the page renderer for Node and `ocr/` (Tesseract OCR and the builder that makes scanned PDFs searchable) |
| `reader/` | the PDF reader: protocol, preferences, citation formats, and the host controller that answers reader messages for every host ([contracts/reader-host.md](contracts/reader-host.md)); `sidecar/` has the per-paper data store and reading state; `logic/` has the pure logic in `navigation/`, `text/` and `presentation/`; `dom/` has the reader UI and its styles, grouped into `elements/`, `session/`, `navigation/`, `text/`, `chrome/`, `sidebar/`, `hover/` and `startup/`; `node/` has the Node sidecar port (VS Code and the terminal) |
| `library-ui/` | the library surface a host mounts once: the host message protocol and its in-page loopback channel ([contracts/library-ui-host.md](contracts/library-ui-host.md)), the view store and prefs in `state/`, list rows, scope and sorting in `derive/`, the list keymap and the PDF wording; `dom/` has the frame, header, list, detail pane, drag-and-drop, the dialogs in `flows/`, and its stylesheet |
| `ui/` | the design system: tokens, base styles, components (button, menu, dialog, toast, quick input), the settings page components in `dom/settings/` (page, section, row, fields) that the browser options page uses, icons |
| `ai/` | embeddings contracts and the hash embedder, chunking, retrieval, PDF text extraction, the ingestion pipeline, the indexer that keeps the index current from host-supplied paper events, and the `AiService` facade with similar-paper ranking; `node/` has the `node:sqlite` vector store and AI storage (loaded lazily, since `node:sqlite` is flagged on Node 22.6) |
| `logging/` | the JSON-lines log format and a logger over a port; `node/` has the file log sink |

Each domain folder has an `index.ts`. Inside a domain, related files are grouped in subfolders once there are more than eight (for example `import/registries/`, `reader/dom/sidebar/`).

## Ports and composition roots

Core never reaches the platform directly. It declares a port, and each app implements it:

| Port | VS Code | Browser | Terminal |
|---|---|---|---|
| file system / local tree | `vscode.workspace.fs` adapter | IndexedDB | core `node/` |
| lock store | core `node/` | none (one browser, no shared folder) | core `node/` |
| sidecar port | core `node/` | IndexedDB | core `node/` |
| auth | core `node/` PKCE + `SecretStorage` | `identity.launchWebAuthFlow` | core `node/` PKCE + keychain |
| reader transport | webview `postMessage` | in-page calls | no reader (system viewer) |
| library UI transport and prefs | webview `postMessage`, webview state | in-page loopback, localStorage | no library UI (TUI) |

Each app has exactly one composition root, and only that root instantiates adapters:

- VS Code: `packages/vscode/src/extension.ts`; it takes the Node adapters from `activation/node/` and hands the rest of the extension the neutral `HostAdapters` interface (see [Node code in VS Code](#node-code-in-vs-code))
- Browser: the background worker entry, plus one bootstrap per page (library, reader, popup, options)
- Terminal: `packages/terminal/src/app/context.ts`

### Node code in VS Code

VS Code code outside a `node/` folder stays runtime-neutral, so the Node-only code sits in `node/` folders behind ports:

- Data that core reads from disk with Node (project lists, settings, values, versions, synctex, backlinks, the build folder) comes through a neutral core port that the composition root puts on `HostAdapters`; its Node implementation lives in core `node/` next to the functions it delegates to. Writing projects use `ProjectDataPort` (`HostAdapters.createProjectData`).
- Path logic uses the injected `PathOps`, and file reads use `vscode.workspace.fs`.
- `HostAdapters` carries the disk (`fs`, a `LibraryFileSystem`), `paths` and the per-device places (`deviceLayout`), so neutral code builds project data and reads the library without Node. The desktop root fills them from `activation/node/`.
- The Node registrations (builds, history, LaTeX) reach the Writing view through the `PlatformWriting` port in `writing/platformPort/`, so the neutral registration can run over a fake in tests.
- Code that spawns a process or hands a real disk path to an external tool (LaTeX and Typst builds, toolchain setup, figure regeneration, the project check, PDF compare) lives in a `node/` subfolder of its feature. All of it registers through one Node entry per area (for writing, `registerNodeWriting` in `writing/node/`), which `extension.ts` passes into the neutral registration. Neutral code sees it only through neutral types (for writing, `writing/nodePort/` and `ProjectBuilders`).
- Only `extension.ts` imports a VS Code `node/` folder; `node/` folders may import each other.

## Design system

The design system gives the three apps one look:

- **Tokens** are defined once, as data in `core/src/ui/tokens/`: colour roles for light and dark, the status colours, one highlight palette keyed by annotation colour, the type scale, spacing, radii and elevation. `pnpm --filter @labshelf/core tokens` renders them into the committed `core/src/ui/dom/tokens.css` (`--ls-*` custom properties), and a core test fails when the file drifts from the data. The terminal maps the colour roles onto the 16 ANSI colours, so it follows the user's terminal theme.
- **In VS Code**, a host stylesheet maps each `--ls-*` token to the matching `--vscode-*` variable, so the UI follows the user's VS Code theme. **In the browser**, `tokens.css` supplies values that match VS Code Dark Modern and Light Modern. Components use only `--ls-*`, so the same component looks the same in both hosts.
- **Components** (`core/src/ui/dom/`) and **icons** (one inline-SVG set) are shared by the VS Code webviews, the browser pages, the reader and the website. The icon geometry is Lucide, hand-copied into `core/src/ui/icons/glyphs.ts` and drawn at stroke 1.5; the Lucide (ISC) and Feather (MIT) licences are in `core/src/ui/icons/LICENSE-lucide.md`. Filled 16 px glyphs are VS Code codicons: `core/tools/codicons/codicons.json` maps each glyph name to a codicon file name, `pnpm --filter @labshelf/core codicons` writes the SVG bodies into `codiconGlyphs.ts` from `@vscode/codicons`, and `lint` fails when the file is stale. To add a codicon, add a line to the map and run the script; the CC BY 4.0 attribution is in `core/src/ui/icons/LICENSE-codicons.md`.
- **The reader** derives its page themes (light, dark, sepia, high contrast) from the same tokens. Its pdf.js page colours and its CSS read from one table.

## Build and test

- Every app bundles core from source with esbuild, the VS Code extension host included. Core has no build step of its own: its `package.json` `exports` map points at source. Typecheck runs `tsc --noEmit` per runtime tsconfig.
- Tests live next to the package they test (`packages/<pkg>/__tests__/` mirrors `src/`). Core has its own jest suite, and app suites test only app code.
- Lint enforces the rules in [AGENTS.md](../AGENTS.md) that a machine can check:
  - ESLint `max-lines` and `max-lines-per-function`;
  - import boundaries (dependency-cruiser): no app-to-app imports, no neutral → `node/` or `dom/` imports, no deep imports past an `index.ts`, and in VS Code no `node:*`, core `node/` or Node-only package (Tesseract, native canvas, pdfjs-dist) outside a `node/` folder, and no import of a VS Code `node/` folder except from `extension.ts` or another `node/` folder;
  - unused files, exports and dependencies (knip);
  - directory size and per-runtime tsconfigs in core (`scripts/check-directory-size.mjs`, `scripts/check-runtime-tsconfigs.mjs`).

  Any violation fails `pnpm lint`. Neutral core compiles against the `ES2022` and `WebWorker` libs: the web-platform globals every runtime has (`fetch`, `URL`, timers, `TextEncoder`, Web Crypto) and no DOM.
