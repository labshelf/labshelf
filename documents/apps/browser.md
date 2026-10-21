# Browser extension

Read when you build, load, change or verify the browser extension.

A Chrome and Firefox MV3 extension. It captures papers from any tab or from Google Scholar and Google search results, keeps its library in a folder on disk (picked in the browser, or served by the bridge), or in this browser when it has neither, and reads PDFs with the same reader as VS Code.

## Where the library lives

Every extension context (background, library page, popup, options) looks for a picked folder, then probes the bridge once ([bridge.md](../contracts/bridge.md)), and keeps the answer.

- A folder picked in the browser wins. Chromium browsers open it with the File System Access API: the banner's **Choose a folder on this computer** and the options page's Library row pick it, and the handle is kept in the `labshelf-library-folder` IndexedDB database. The other contexts switch to it when the pick is announced on the `labshelf-library-folder` broadcast channel. After a browser restart Chrome may ask for permission again: the library page then shows **Allow access**, and until the user allows it, calls on the folder fail instead of reaching browser storage. Firefox cannot open folders on disk, so there the folder comes only through the bridge.
- When `hello` succeeds, the context reads and writes the library folder through the bridge, with the same layout as the desktop apps. Folder changes rebuild the paper records and reach open pages as a `folder` broadcast.
- When the first probe fails, the context stores the library in this browser (IndexedDB, same layout). The library page shows a warning that uninstalling the extension deletes it and why the bridge is unavailable. It offers the folder picker where the browser has one, otherwise the LabShelf Helper download (which registers the bridge host) and the desktop apps' Connect the Browser; when the host runs without a library, it asks for the folder's path (`setLibrary`). A context on browser storage probes again on **Check again** and after a minute, so a bridge connected later is found without a restart.
- A context that chose the folder never falls back to browser storage. A later bridge failure surfaces as an error, so a paper is never saved where the folder does not see it.
- Once the folder is chosen and the browser still holds papers, the library page offers "Move N papers to <folder>". The move copies each paper, verifies it, then clears it from browser storage. A paper whose id already exists in the folder stays in the browser and is listed.
- The options page has a **Library** row that shows the folder or "This browser" with the reason, a **Check again** button and, in Chromium browsers, the folder picker.

## Build

```bash
pnpm --filter @labshelf/browser build            # both targets → dist/chrome, dist/firefox
pnpm --filter @labshelf/browser build:chrome
pnpm --filter @labshelf/browser build:firefox
pnpm --filter @labshelf/browser lint:manifest    # web-ext lint on dist/firefox
```

- The extension icon uses the standalone blue chevron on a transparent background, without lettering.
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
- The search page content script (Scholar and Google results) renders inside a shadow root and loads the tokens as text, with `:root` rewritten to `:host`.
- Native messaging to LabShelf Helper is opened by extension pages, not by the service worker, so the helper lives only while such a page is open ([contract](../contracts/helper.md#transport)).
- The LaTeX setup card offers LabShelf Helper first. As the alternative to installing an unsigned program, it points to VS Code or the terminal app, either of which serves the same helper host ([registration](../contracts/helper.md#registration)).
- Cloudflare-protected publishers (ACM, SIAM, ScienceDirect) block headless browsers and plain `fetch`. Real downloads from them can only be tested by hand.

## Verifying template publication

Use a scratch library configured for both the browser and Helper. In Templates, choose Publish a template, select a saved LaTeX or Typst project, complete the form and run its checks. Verify the first-page preview, reject a project containing a symlink, hard link or `.latexmkrc`, and confirm a failed build leaves submission unavailable. Sign in with GitHub, enter the displayed code and verify the authorized account. Submit only to an authorized test catalog; check that its pull request includes the source, manifest, sample PDF and thumbnail, and that My templates contains the same files. Test cancellation of sign-in and a disconnected or mismatched Helper.

The OAuth App’s public Client ID ships with the extension. Its registration belongs to the LabShelf organization; enable Device Flow in GitHub’s organization settings under Developer settings → OAuth Apps. No Client Secret is bundled. VS Code uses its host’s GitHub authentication provider.

## Library page sidebar

The sidebar is core's library sidebar, as in VS Code: Library, Projects and Spaces. Spaces appears whenever Library is shown. All Spaces opens the catalog; each Space expands to its folders and paper references. The section offers New Space, and a paper's Add to Space… menu adds a reference without moving the paper. Space storage and reference rules follow the [Spaces contract](../contracts/spaces.md). Projects lists the library's writing projects with their tooltip (main file, compiler, reading progress over the papers a project lists). A click opens the project in the library page's project session, and the row menu offers Open PDF when a built PDF sits beside the main file. The browser hides what it cannot do: new blank projects, adding a folder and project folders. Explore templates opens the Templates tab, the same gallery as VS Code over the same sources; publishing uses the connected Helper for validation, compilation and submission ([contract](../contracts/helper.md#template-publication)). GitHub authorization uses the LabShelf organization’s OAuth App with Device Flow enabled and the `public_repo` scope. The token lives only in the Templates tab’s memory and is sent to the Helper on submission.

## Library page workspace

The library page is a tabbed workspace. The sidebar heading groups the brand and Settings with breathing room above the sections, without a dividing rule. The text-only heading and section indentation follow VS Code. Panes have rounded borders and resize gaps with three-dot grips; the source and preview footers share a height. Slim, empty title and status bars frame the workspace; the source appearance controls stay in the source footer. Tab kinds are Library, Templates, All projects, All Spaces, a Space, and a project's Source, Preview, History, Comments and Search. The open tabs and the active one are written to the page hash as `#/tabs/<id>,<id>;active=<id>`, and to `sessionStorage["labshelf.library.tabs"]`, so a reload restores them. A folder deep link (`#/papers/...`) and the tabs hash coexist: the router leaves the open folder alone while the hash is a tabs hash. A paper's path in the hash (`#/papers/<folder>/<id>`) opens its folder and selects it. A Space tab keeps its inner tab in its id (`space:<id>:<tab>`), so a reload restores Overview, Papers, Notes, Discussions, Discover or Glossary. Opening a Space leaves the catalog open.

The page-level right pane shows Details or Research chat. Two buttons at the end of the right-most group's tab bar select the mode; pressing the selected button collapses it. Details shows the last selection made in the paper list or in All projects ([contract](../contracts/details-host.md)); Research chat follows the active Space. Its model-dependent controls show why they are unavailable. A sash on the pane's left edge resizes it; it opens as wide as the sidebar until the user drags it, and a double-click on the sash returns it to that width. The selected mode, shared width and collapsed state persist in page prefs. A folder Details asks to open is shown in the Library tab.

- Source edits a project file in a CodeMirror editor; edits go to LabShelf Helper for builds ([helper.md](../contracts/helper.md)). Cmd/Ctrl+S in the editor saves the file and asks the helper for a build. The editor's title bar carries the VS Code actions: Show Project History, Insert Symbol, Insert Table, Insert Image, Search in Project, Cite from Library, and Bold and Italic in the overflow menu. The source footer picks the editor's syntax colour theme and code font; the choice is stored in the page prefs and applies to LaTeX and Typst alike. The code fonts are bundled by the build, not fetched.
- Preview fits the PDF width to the page viewport without a surrounding margin. It shows the built PDF in the core reader and updates page by page from `pages`. Repeated Recompile requests share an active full build until a source edit supersedes it. A helper request failure ends the build status with an error and keeps the displayed PDF. The page serves the reader's header and footer actions: Recompile, a problem's source line, Compare, Mark version, the check limits and the build options menu. Auto-compile and halt-on-error are per-user settings; the LaTeX engine is written to the project's labshelf.yaml. Engine and halt-on-error appear only for LaTeX projects.
- Search finds and replaces text across the project's files.
- Typst completion, hover and go to definition run in the page, from the core Typst language service, with or without the helper.
- History lists the project's recorded edits, versions and restores, with Restore this point and Mark Version. Open editors reload after a restore. The history is kept in the browser's storage, not in the project folder. Compare Versions is desktop-only: the page toasts that it needs the VS Code extension or the terminal app.
- Comments lists a project's comment threads from `comments.json`; in a joined project the threads are live over the share.

### Shared projects

The page shares, joins, resumes and leaves projects through the core workflows, the same steps VS Code runs ([collaboration.md](../contracts/collaboration.md#sharing-joining-and-leaving)). Share, invite, leave and join open the common core sharing dialogs from the sidebar's project menus, the open project's menu, the All projects menus and `#join` links. Every surface keys a project by its folder.

- **Share.** A project's context menu in the sidebar, and the open project's menu, offer Share Project… for an unshared project. With no Cloudflare relay connected the page first offers to connect one, and a cancel shares nothing. The page then offers the owner's relay to the share, copies the invite link and shows it in a dialog, with Copy Link when the clipboard refused the write.
- **Copy Invite Link.** A shared project's menus offer Copy Invite Link, which reconnects the project from its stored key when this tab does not run it and hands out the invite with the relays the share lists at that moment. A shared project whose key this device lacks offers to join it again instead.
- **Stop Sharing on This Device….** After a confirmation, the page closes the connection, forgets the key, removes `shared` from labshelf.yaml and deletes the share's IndexedDB state. Every file stays. When the close cannot store the last edits, nothing is forgotten and a toast says the project stays shared.
- **Join.** Join Shared Project… in the Projects section, or a join link ([share-link.md](../contracts/share-link.md)) opened as `library-page/index.html#/join/<invite>`, with the invite in the fragment so it never reaches a server, waits for a member to answer, and offers to open the project. The collaborators see the stored display name, or Guest when none is stored. A refused invite shows why in a dialog and creates nothing; joining a project this library holds already reconnects it. The page mirrors the project's files into the library through the bridge (or browser storage) and edits it with live cursors and comments.
- **Resume.** At page start, when the page becomes visible again, and after every share, join or leave, the page reads the project list and reconnects each shared project from its stored key. A shared project without a stored key asks once to join it again; a reconnect that fails is shown once. A project that another tab runs is left to that tab.

Connecting Cloudflare offers the new relay to the shares this page runs; disconnecting it takes the relay out of the library's shares and stored invites.

The key and relays of each shared project are kept in `chrome.storage.local["collabShares"]` under the library id and then the share id, so a reload reconnects without the invite and two libraries never see each other's keys; the display name is kept there once for all libraries. The library id is `browser` for browser storage, `bridge:` plus the first 16 hex characters of the SHA-256 of the root the helper reports for a bridged folder, and a random id stored with the handle of a picked folder (picking the same folder again keeps it). Keys stored without a library id move under a library once one of its projects names their share id.

The mirror writes each project to the storage of the library source it started on and to no other. One tab per library and share owns the mirror; another tab reports it busy and can take it over, which stops the first. A folder source also takes the project's lease file, shared with VS Code, so only one app mirrors a folder ([collaboration.md](../contracts/collaboration.md#mirror-ownership)). Edits made to a folder outside the browser are picked up by a rescan when the tab becomes visible and every 30 seconds.

A source tab of a shared project edits the file's shared text, which the page stores durably in IndexedDB, so edits made while no relay is reachable sync once one is. Every file the page itself writes, renames or deletes in a shared project, such as an inserted image or a Replace All, reaches the share's mirror at once, without waiting for a rescan; a binary file travels as a blob. When the share is not connected in the tab, the tab shows the file read-only, without comments or insert actions, under a notice with Retry, which reconnects the share from its stored key, so no edit stays outside the share. Undo in a shared file reverts only this user's edits.

### Cloudflare relay

The cloud button in the sidebar heading, shown when the page shows Projects, connects the owner's Cloudflare account as VS Code's Connect Cloudflare does: after the owner confirms, the page opens the Cloudflare sign-in in a tab, deploys the relay Worker to the chosen account and waits for its address. When an account is connected, the same button shows the relay's host and offers Disconnect, which deletes the relay and forgets the account. Sign-in, connect and disconnect run in the library page, which must stay open until the sign-in tab closes; a second page that tries at the same time is told another page is busy. A share that needs the owner's relay asks for it with one call, which returns the connected account or runs the same connect, and returns nothing when the owner cancels. Failures are logged and shown in a toast; a sign-in tab the owner closes is only logged. Every page start brings the deployed relay up to the bundled Worker build. Storage and sign-in: [relay.md](../contracts/relay.md#owner-account).

### Share links

A folder's context menu in the sidebar offers Share as Link…, and the Library heading menu offers Manage Shared Links… and Import Shared Link…; they open the common core sharing dialogs, which VS Code's commands of the same names also open ([library-ui-host.md](../contracts/library-ui-host.md#sharing), [share-link.md](../contracts/share-link.md)). Sharing asks for the owner's relay (connecting Cloudflare when none is connected, on a page with or without Projects), shows the rights notice with the choice to share with or without annotations, shows the upload's progress in the list header, and copies the link, offering Open Link. Manage Shared Links lists this browser's shares of the library newest first, to copy, open or revoke after a confirmation. Import takes a pasted link, refused as the user types when it does not parse, copies the shared papers into a new folder under the library root, refreshes the view and sums up what was added, what the library already held and which PDFs the relay could not serve, offering Open Folder. Shared annotations are not imported. A share page's Open in LabShelf button opens VS Code only, so in the browser a pasted link is the way to import.

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

A paper without a PDF offers "Ask the author" in the Details pane and in the "No PDF found" dialogs. The background reads author addresses from the article page (author e-mail meta tags and correspondence `mailto:` links), then from PubMed's "Electronic address" affiliations, and opens a `mailto:` for at most three of them. Nothing is sent by LabShelf; the user sends the email from their own mail client. With no address, the article page opens instead and nothing is recorded. Opening the email writes `pdfRequestedAt`, which the pane shows while the paper has no PDF. The options page holds the name, affiliation and language that the email is written with.

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
- To test a page without the background, serve `dist/chrome` statically and inject a callback-style `window.chrome` stub (webextension-polyfill needs only `runtime.id`). Seed IndexedDB `labshelf` v1 on the same origin before navigating to `library-page/index.html`, which mounts core's library UI over an in-page loopback ([library-ui-host.md](../contracts/library-ui-host.md)) and the Details pane over a second one ([details-host.md](../contracts/details-host.md)); the Details pane's projects channel is served only when Projects is available and reads reading stats and annotations from the papers' sidecars.
- To test the search page content script on a fixture, `Fetch.enable` for `https://scholar.google.com/scholar*` or `https://www.google.com/search*` and fulfil the request with the fixture HTML.
- To test the popup against an article tab, open `popup/index.html` in a 340 px target, overriding `chrome.tabs.query` through `Page.addScriptToEvaluateOnNewDocument`.
- For reader parity with VS Code, render both readers on the same real paper and pixel-diff the toolbar and sidebar. CDP drags do not create text selections in either reader; select with a `Range` plus a synthetic `mouseup` instead.

### Collaboration against a local relay

Relay URLs must be `https:`, so a local relay needs TLS and no Cloudflare account.

- Bundle the Worker with `bundleRelayWorker` from `packages/core/tools/relayWorker/`. Run it with `wrangler dev --local --local-protocol https --ip 127.0.0.1 --persist-to <scratch>`, binding the Durable Object `ROOM` (class `Room`, `new_sqlite_classes`) and a KV namespace `KV`, with `OWNER_SECRET` in `.dev.vars`.
- Launch Chromium with `--ignore-certificate-errors` (it covers `wss`) and `--no-proxy-server`. Set `NO_PROXY=127.0.0.1,localhost` for Node tooling.
- Seed the owner profile's relay account in IndexedDB `labshelf-relay-account` (store `secrets`, key `account`) as the JSON of `{accountId, relayUrl, ownerSecret, kvNamespaceId, credential:{kind:"token", token}}`. A current local relay needs no Cloudflare API call. The joining profile needs no account.
- Join in a second profile at `library-page/index.html#/join/<invite>`. Read the `labshelf` and `labshelf-collab` databases to check stored content.

### Headless Firefox

Stock Firefox is driven through geckodriver, because Playwright's Firefox needs its patched build.

- Start geckodriver with `--allow-system-access`; without it, extension pages are unscriptable.
- Run Firefox with `-headless` and the pref `extensions.webextensions.uuids={"labshelf@lucanaasser.dev":"<fixed uuid>"}` so the page URL is known. Install `dist/firefox` as a temporary add-on.
- Navigation to `moz-extension://` is refused. Load an http page, then set `location.href` to `moz-extension://<uuid>/library-page/index.html` from `executeScript`. Only web-accessible pages open this way.

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

## Checking Spaces

Use a scratch library with papers and a writing project.

1. Create a Space from the sidebar and another from All Spaces. Check both appear in the catalog and sidebar; search the catalog and open a Space while keeping the catalog tab.
2. Add a paper to both Spaces through Add to Space…. Create a Space folder, move the reference, then delete the folder and remove the reference. Check the sidebar follows each edit and the paper remains in Library.
3. Link the project, set a focus paper, add a date and a glossary term, and export the calendar. Reload with Glossary selected and confirm the inner tab is restored. Return to the page after editing the Space through another app and check its contents refresh.
4. Switch between Details and Research chat, focus different Space tabs, resize and collapse the pane, then reload. Check the mode, width and collapsed state persist and chat names the active Space.
5. Check keyboard navigation and light and dark themes. Inspect unavailable controls for their explanatory tooltips, then delete a Space and confirm its papers and project remain.

## Checking source editor appearance

Check dark and light themes: the focused cursor blinks with a solid, contrasting stroke, selected text has a blue background, and a selection remains visible on the active line, across wrapped lines and after focus moves to another control.

## Checking preview stability and latency

Use an isolated project with two sections sharing a page and another with explicit page breaks. After a full build, edit a paragraph in each, including an edit that adds a page. The preview keeps neighboring content and page order; inspect the helper log for the section fallback reason. Save during a preview and click Recompile repeatedly: the preview completes before one full build starts. A build with no page changes keeps the reader mounted.

Compare the helper's `syncMs`, `compileMs` and `pagesMs` with the browser's build-reply and assembly times. The request time includes the helper's work; it is not a network-only measurement. Use a warmed preamble cache and the same document when comparing runs.
