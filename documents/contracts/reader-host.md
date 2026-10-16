# Contract: PDF reader and its hosts

Read when you change the PDF reader or the code that hosts it.

The PDF reader is one UI that runs inside two hosts: the VS Code webview and a browser extension page. Hosts own persistence, clipboard, files, external links and settings. The reader owns everything on screen. They talk only through the typed message protocol in the reader's `protocol` module, which is the single source of truth for message shapes.

One host controller in core answers every message the reader sends. Each host implements the controller's ports (sidecar store, posting to the reader, preferences, the auto theme, clipboard, notices, external links, saving the Markdown export, logging, and optional hooks for sidecar changes and reading activity) and keeps only its own lifecycle: creating the view, forwarding theme and preference changes, and asking for a page.

## Startup

1. The host serves the HTML shell (shared by both hosts) with an inert JSON boot block, `ReaderBootParams`. The block carries the protocol version, asset URLs, paper id and title, theme preference and effective theme, reader preferences and `isMac`.
2. The host's entry calls `startReader({ boot, transport, perf, pdf? })`. The transport hides how messages travel: `postMessage` in VS Code, in-page calls in the browser. `pdf` lets a host supply the paper bytes and the worker. The browser starts workers from the extension URL, because Firefox refuses `blob:` workers.
3. The reader sends `ready-for-init`. The host answers `init` with the reading state, annotations, preferences and theme.
4. The reader sends `ready` with the page count once the document is laid out.

## Rules

- **Every message has one handler.** Adding a message means adding its handler to the shared host controller; a host changes only when the message needs a port it does not implement yet.
- **Messages wait for `ready`.** The reader drops host messages other than `init` and `applyTheme` before the document is laid out. The controller holds the latest of each type and sends them on `ready`.
- **Every failure is logged and shown.** A handler that throws is logged with the paper and command and becomes a `Reader action failed` notice; a rejected annotation write becomes a `Failed to create|update|delete annotation` notice and the reader keeps its list.
- **The host validates untrusted input.** Messages from the reader go through `isWebviewMessage`, so a malformed message is rejected and never half-applied. External links go through `isSafeExternalUrl`, which allows only `http:`, `https:` and `mailto:`, so a crafted PDF cannot open `file:`, `command:` or `vscode:` URIs.
- **Preferences are validated once.** Both hosts pass stored preferences through the shared `normalizeReaderPrefs`. VS Code reads them from settings; the browser reads them from extension storage.
- **The sidecar format is shared.** The host persists annotations, theme and reading position through the shared `PaperDataStore` over a `SidecarPort`, which keeps the bytes identical everywhere ([library-format.md](library-format.md#sidecar-datajson)).
- **Reading position is saved only after restore.** The reader does not report a position until it has restored the stored one, so the initial page-1 layout never overwrites it.
- **`PROTOCOL_VERSION` changes whenever a message changes shape.**

## Preview

A host can show a build's output in the reader, e.g. a writing project's compiled PDF. It then implements the controller's preview ports and drives the reader through the controller:

- **Reload in place.** After a build replaces the PDF, the host asks for a reload. The reader re-reads the bytes and keeps the page, the offset on it and the zoom. A failed build leaves the file and the reader untouched.
- **Build status.** The host reports `building`, `succeeded`, or `failed` with the error count. The reader shows a banner while a build runs and while the last one failed; clicking a failed banner asks the host to open the first error.
- **Source and preview positions.** Points travel in PDF user space: page number and points from the page's top-left corner. Only a preview reader (`ReaderBootParams.preview`) reports a double-click, as `showSource`; a library reader leaves double-clicks alone. The host reveals a point, e.g. the editor cursor, and the reader scrolls to it and marks it; a page number past the document's last page is clamped to it.
- **Citations.** A preview reader asks which cited papers stand behind a link, or behind text it reads as a citation, with `lookupCitation`: a request number, the place as a page area in the same space as points, whether it is a link, and the link's destination name when it has one. The host always answers with `citation` under the same number, also when it finds nothing or fails, so the reader never waits; each entry is a cite key with its library paper when the library has one.
  - LaTeX: a destination named `cite.<key>` (hyperref; biblatex writes `cite.<n>@<key>`) names its key, and any other LaTeX link names none. Text without a link, from a build without hyperref, goes through SyncTeX to the keys cited on its source line.
  - Typst: a link names the citation that the last build placed inside it.
  - Hovering shows a card with the paper. Clicking a citation link whose key has a library paper opens that paper (`openCitedPaper`) instead of jumping to the bibliography; any other link keeps its jump.
- **The browser previews nothing yet.** Its host has no preview ports, so the controller logs a preview request from its reader and ignores it.

## Changes

A host can mark regions of the PDF as changed, e.g. what differs from another version of the paper ([library-format.md](library-format.md#labshelfversions)). It sends `showChanges` with page areas in the same space as preview points; the reader draws them over the pages and keeps them through zoom and re-rendering. Each message replaces the earlier marks, and an empty list clears them. A reload request drops the marks sent before it, because they describe the document they came with; marks sent after it apply to the reloaded document. Any reader accepts the message, library or preview.

## Host-specific constraints

| Host | Constraint |
|---|---|
| VS Code | strict webview CSP with a nonce; assets through `asWebviewUri`; default webview CSS and theme variables are injected by VS Code |
| Browser | MV3 forbids inline scripts; the manifest needs `'wasm-unsafe-eval'` for pdf.js; minimum versions are Chrome 125 and Firefox 128 (the pdf.js 6.3 floor); the reader page never loads the library page's `base.css` |
