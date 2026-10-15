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
- **The browser previews nothing yet.** Its host has no preview ports, so the controller logs a preview request from its reader and ignores it.

## Host-specific constraints

| Host | Constraint |
|---|---|
| VS Code | strict webview CSP with a nonce; assets through `asWebviewUri`; default webview CSS and theme variables are injected by VS Code |
| Browser | MV3 forbids inline scripts; the manifest needs `'wasm-unsafe-eval'` for pdf.js; minimum versions are Chrome 125 and Firefox 128 (the pdf.js 6.3 floor); the reader page never loads the library page's `base.css` |
