# Browser extension

Read when you build, load, change or verify the browser extension.

A Chrome and Firefox MV3 extension. It captures papers from any tab or from Google Scholar, keeps its own copy of the library in IndexedDB and reads PDFs with the same reader as VS Code.

## Build

```bash
pnpm --filter @labshelf/browser build            # both targets → dist/chrome, dist/firefox
pnpm --filter @labshelf/browser build:chrome
pnpm --filter @labshelf/browser build:firefox
pnpm --filter @labshelf/browser lint:manifest    # web-ext lint on dist/firefox
```

- One source tree builds both targets. Only the manifest differs: Chrome uses a `service_worker`, and Firefox uses `background.scripts` plus the gecko id `labshelf@lucanaasser.dev`.
- pdf.js is vendored from the `pdfjs-dist` legacy build into `vendor/pdfjs/`. `pdf_viewer.mjs` is lowered to es2023 so that `web-ext lint` passes.

## Load

| Browser | How |
|---|---|
| Chrome / Chromium 125+ | `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome` |
| Firefox 128+ (temporary) | `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/firefox/manifest.json`, or `pnpm --filter @labshelf/browser dev:firefox` |
| Firefox (permanent) | Developer Edition, Nightly or ESR with `xpinstall.signatures.required=false` and `package:firefox`; for release Firefox, sign it unlisted with `web-ext sign --channel=unlisted` |

The minimum versions are the floor for pdf.js 6.3.

## Platform constraints

- MV3 forbids inline scripts. The theme is applied before first paint by a separate classic script in `<head>`, with the preference stored in `localStorage["labshelf.theme"]`.
- The extension pages' CSP is `script-src 'self' 'wasm-unsafe-eval'`, which pdf.js needs for its WebAssembly decoders.
- Firefox refuses `blob:` workers, so the pdf.js worker starts from its extension URL.
- The Scholar content script renders inside a shadow root and loads the tokens as text, with `:root` rewritten to `:host`.
- Cloudflare-protected publishers (ACM, SIAM, ScienceDirect) block headless browsers and plain `fetch`. Real downloads from them can only be tested by hand.

## Citation map

A fixed **Citation map** row at the top of the library page's sidebar opens the citation map in place of the paper list ([contract](../contracts/library-ui-host.md#citation-map)). The background builds it from OpenAlex and caches the data in IndexedDB ([contract](../contracts/library-format.md#openalex)).

## Capture structure

Identifier detection, landing-page parsing, metadata resolution and the PDF finder live in core `import/` and are shared with the other apps. `src/capture/` keeps only what needs the browser: the page probe content script, the helper tab and tab fetch (`capture/tab/`), the watched sign-in tab (`capture/watch/`), the capture and Scholar flows, and mapping a draft to a record.

When the PDF finder stops at a sign-in page or a bot check, the helper tab loads candidate pages in a background tab to pass what a script can pass. When the user chooses to open the page, a visible tab is opened and watched: each time a page in it finishes loading, the extension looks for a PDF and attaches it to the paper. The watch is kept in `storage.session`, so it survives the service worker sleeping, and ends after 5 minutes, when the tab closes, or when the PDF is attached. After that, publisher pages that asked for a sign-in are retried through the Library proxies listed in the options page (a prefix with `$@`, a hostname suffix or an OpenAthens redirector), top to bottom; when a proxy answers with its own sign-in page, that page is the one the dialog offers to open.

The options page also lists Custom resolvers, empty and off by default. Each enabled entry is an address with `{doi}` where the paper's DOI goes. When no other source has the paper, the PDF finder opens the entries top to bottom and reads each answer like any other page: a PDF link in it is followed, and a bot check or sign-in wall goes to the helper tab and the watched tab. The extension names no site; the user supplies every address. A stored mirror toggle and address become one enabled entry when the profile loads.

## PDF offers

The background watches finished downloads and PDF tabs. For each new PDF address it re-fetches the bytes from the final URL with the user's cookies (extensions cannot read the downloads folder), because the address alone cannot name a paper. Core's `matchPdfToPaper` then matches it against the papers that have no PDF: first by DOI or arXiv id in the URL, then by the title on page 1.

- Page 1 is read as text by pdf.js. Chrome's service worker cannot start a worker, so it asks an offscreen document (`pdfText/offscreen.html`, Chrome only and not built for Firefox); Firefox reads in place.
- The bytes wait in their own IndexedDB database, `labshelf-pdf-staging`, outside the library file store. They leave it when the user attaches or dismisses the offer.
- A match marks only that tab's toolbar button with a `PDF` badge. The popup then offers "Attach to <paper>". No system notification is used, which would need the `notifications` permission.
- Open offers and the addresses already looked at live in `storage.session`, so they survive the service worker sleeping.

## Find Published Version

A paper whose PDF is a preprint or accepted manuscript (`pdfVersion` in [library-format.md](../contracts/library-format.md)) shows "Find Published Version" in its menu. The finder looks up the DOI of the published record, ranks candidates so a `published` one wins, and replaces `paper.pdf` only after the user confirms. Replacing sets `pdfVersion` to the new file's version.

## Ask the author

A paper without a PDF offers "Ask the author" in the detail pane and in the "No PDF found" dialogs. The background reads author addresses from the article page (author e-mail meta tags and correspondence `mailto:` links), then from PubMed's "Electronic address" affiliations, and opens a `mailto:` for at most three of them. Nothing is sent by LabShelf; the user sends the email from their own mail client. With no address, the article page opens instead and nothing is recorded. Opening the email writes `pdfRequestedAt`, which the pane shows while the paper has no PDF. The options page holds the name, affiliation and language that the email is written with.

## labshelf: links

`web+labshelf:` links ([links.md](../contracts/links.md)) open the library page with `?link=<link>`. The page resolves the cite key through core and replaces its own tab with the reader at the page, so a click leaves no extra tab. An unknown key or a malformed link shows an error toast and a log entry.

- Firefox declares the handler in `manifest.firefox.json` (`protocol_handlers`, a relative `uriTemplate`).
- Chrome's manifest has no such key. The library page calls `navigator.registerProtocolHandler` on load when the manifest declares none, and Chrome asks the user to allow it. The page logs a refusal and carries on.
- Opening `library-page/index.html?link=...` by hand exercises the resolution. Whether a click on a page reaches the handler needs a headed browser, because the registration needs the user's approval.

## Headless run

Playwright's full Chrome for Testing can load the unpacked extension. Run it outside the sandbox:

```bash
"~/Library/Caches/ms-playwright/chromium-<ver>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  --headless=new --load-extension=<repo>/packages/browser/dist/chrome \
  --disable-extensions-except=<same> --remote-debugging-port=0 --user-data-dir=<scratch>
```

- The DevTools port is in `<user-data-dir>/DevToolsActivePort`. Node has a global `WebSocket`, so the DevTools protocol can be driven without dependencies.
- Pick the extension's service worker by `url.endsWith("/background/index.js")`. Chrome for Testing ships a component extension whose worker comes first. Read `chrome.storage.local` by evaluating in that worker.
- To test a page without the background, serve `dist/chrome` statically and inject a callback-style `window.chrome` stub (webextension-polyfill needs only `runtime.id`). Seed IndexedDB `labshelf` v1 on the same origin before navigating to `library-page/index.html`, which mounts core's library UI over an in-page loopback ([library-ui-host.md](../contracts/library-ui-host.md)) and reads reading stats and annotations from the papers' sidecars.
- To test the Scholar content script on a fixture, `Fetch.enable` for `https://scholar.google.com/scholar*` and fulfil the request with the fixture HTML.
- To test the popup against an article tab, open `popup/index.html` in a 340 px target, overriding `chrome.tabs.query` through `Page.addScriptToEvaluateOnNewDocument`.
- For reader parity with VS Code, render both readers on the same real paper and pixel-diff the toolbar and sidebar. CDP drags do not create text selections in either reader; select with a `Range` plus a synthetic `mouseup` instead.

### Chrome DevTools MCP

The project-scope `.mcp.json` registers `chrome-devtools-mcp` (version pinned, headless, isolated profile, extension tools on, usage statistics and CrUX lookups off). An agent loads and inspects the unpacked extension without a hand-written CDP harness:

1. `pnpm --filter @labshelf/browser build:chrome`.
2. `install_extension` with `path` = the absolute `packages/browser/dist/chrome`; the result carries the extension id.
3. `new_page` with `chrome-extension://<id>/popup/index.html` (or `library-page/index.html`, `options/index.html`), then `take_snapshot` and `take_screenshot` with the page id that `new_page` lists. `list_extensions`, `reload_extension` (after a rebuild), `trigger_extension_action`, and the console and network tools work on the same session.

- Extension tools need the launched-browser (pipe) connection, so `--browserUrl`, `--wsEndpoint` and `--autoConnect` cannot be used with them.
- File arguments must lie under the client's workspace roots (the repo) or the OS temp directory; write screenshots to the scratchpad.
- The server launches Playwright's Chrome for Testing through `--executablePath` (see [README.md → verifying changes](README.md#verifying-changes)).
- A server added to `.mcp.json` becomes available after the next session start. Project-scope servers ask for approval on first use.
- Without a configured MCP client, the server can be driven over stdio: spawn the `.mcp.json` command, send `initialize` (declaring the `roots` capability and answering `roots/list`), `notifications/initialized`, then `tools/call`.
