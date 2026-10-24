# Build, run and verify the apps

Read when you build, run or verify an app for real.

Unit tests do not cover webview DOM, the real extension host or a real terminal. After a change there, run the app and look at it.

## Rules

- Prerequisites: Node.js 22.13 or later (`node:sqlite`, pdf.js), pnpm 9 or later, `pnpm install` at the repository root.
- **Rebuild first.** A stale bundle shows the old behaviour.
- **Never run against the user's real library.** Work on a copy: `cp -R ~/LabShelf <scratch>/lib`.
- **Isolate config and tokens.** Point `XDG_CONFIG_HOME` and `XDG_CACHE_HOME` at scratch directories and use a throwaway `--user-data-dir`.
- **Use a real paper as well as synthetic fixtures.** Synthetic PDFs miss OCR layers, scans, margin stamps and missing link annotations.
- **Look at the screenshots or text frames.** A passing DOM assertion does not prove the layout.
- **Spare the Cloudflare free quota.** Request-budget checks run against the in-memory fake relay. A run on the real relays lasts a few minutes, reports the billed request counts and never load-tests.
- **Never kill VS Code, Electron or Chrome by name.** The user's own windows run from the same binaries and `pkill`/`killall` closes all of them. Stop only the PID you launched (`$!`), or match your unique `--user-data-dir` with `pkill -f -- "--user-data-dir=<path>"`.
- **Never launch the installed `/Applications/Visual Studio Code.app`.** A test instance of it closed the user's windows even with its own `--user-data-dir`. Use a `@vscode/test-electron` copy and ask the user before the first run on it.
- **Chrome.** `/Applications/Google Chrome.app` crashes headless on this Mac. Use Playwright's Chrome for Testing or its headless shell from `~/Library/Caches/ms-playwright/`. Launch browsers and VS Code outside the sandbox.
- The `chrome-devtools` server in `.mcp.json` sets `--executablePath` to `${HOME}/Library/Caches/ms-playwright/chromium-<ver>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`; `--channel` accepts only installed Chrome channels. After `npx playwright install chromium` changes `<ver>`, update the path to the folder `ls ~/Library/Caches/ms-playwright/` shows.
- One-off harness scripts live in the session scratchpad. A harness that more than one session uses is committed under `scripts/`.

Checks that need no app run: `pnpm verify:library` mounts the core library UI on a made-up library and writes screenshots and console errors to `.verify/library/` (light, dark, narrow; the VS Code theme variables are approximate). `pnpm --filter @labshelf/core eval:pdf` runs the PDF-finding corpus in `packages/core/tools/pdf-eval/` against the live network (reports are git-ignored).

## VS Code

### Build and run

```bash
pnpm --filter @labshelf/vscode build   # host → out/extension.js, reader → dist/reader/, list → dist/library/
pnpm dev:vscode                        # watches the host and the webview bundles
```

esbuild bundles the host from source, including `@labshelf/*`. pdf.js, Tesseract and the native canvas stay external and load from `node_modules`, because they locate their data files and binaries next to themselves. Open the repository in VS Code and press F5 for an Extension Development Host; run **LabShelf: Configure Library** and pick the scratch copy.

### Extension host run

Jest mocks `vscode`, and plain Node passes pdf.js's "am I Node?" check, so both hide bugs that appear only in the extension host. The host is an Electron utility process (`process.type === "utility"`), which pdf.js treats as a browser. Any change to import, OCR, the text layer or pdf.js usage must run in a real host:

1. Create a dummy extension: a `package.json` with `main` and empty `activationEvents`, plus a runner file exporting `run = async () => {…}`. In the runner, `require("vscode")` is real. Require the bundled `out/extension.js` (build first), or bundle the module under test with esbuild. Write runner files with a quoted heredoc (`<<'EOF'`).
2. Launch the binary directly (the `code` CLI wrapper detaches), outside the sandbox, from a `@vscode/test-electron` copy:

   ```bash
   env -u ELECTRON_RUN_AS_NODE "<test-electron copy>/Contents/MacOS/Code" --no-sandbox \
     --user-data-dir=<SHORT path> --extensions-dir=<scratch> --disable-workspace-trust --skip-welcome \
     --skip-release-notes --disable-telemetry --disable-updates \
     --extensionDevelopmentPath=<dummy> --extensionTestsPath=<runner.js> <workspace>
   ```

   `--extensionTestsPath` puts VS Code in test mode, which refuses authentication dialogs; a check that needs an interactive sign-in launches without it.
3. Keep `--user-data-dir` under about 103 characters (IPC socket path limit). The scratchpad path is too long: symlink it from a short path and delete the symlink after the run.
4. The runner cannot see contributed views. A "Bad progress location" log line is harness noise.

A cheaper middle ground reproduces pdf.js's environment but not the host lifecycle: run the script with `ELECTRON_RUN_AS_NODE=1 ".../Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)"` after setting `process.type = "utility"`. To test scans, render a real paper's pages to PNG and rebuild an image-only PDF with pdf-lib.

### Collaboration host run

Use a local relay as in [Browser: collaboration against a local relay](#collaboration-against-a-local-relay), with the scratch CA in `NODE_EXTRA_CA_CERTS` and `NO_PROXY=127.0.0.1,localhost`.

- Launch hosts from a `@vscode/test-electron` copy under `xvfb-run -a` with a short `--user-data-dir`, `--remote-debugging-port` and `--inspect-extensions`. A dev extension with `activationEvents ["*"]` polls a control directory and runs the `{command,args}` files it finds. Never use `--inspect-brk-extensions`: the renderer restarts the host after 10 s.
- On Linux without a keyring, add `--password-store=basic`; otherwise every SecretStorage write never resolves and a share or join hangs after it connects.
- User settings `http.proxySupport: "off"`, `http.fetchAdditionalSupport: false`, `http.webSocketAdditionalSupport: false`: VS Code otherwise patches the host's global `fetch` and `WebSocket` with its own CA list, which drops `NODE_EXTRA_CA_CERTS`.
- Seed the relay account in SecretStorage key `labshelf.relay.account`. Another extension cannot read it, so set a conditional breakpoint `(globalThis.__sec = secrets, false)` on the secret-slot `get` in `out/extension.js` through the inspector, trigger one read, then call `__sec.store(...)` from the runner.
- `labshelf.collab.share` needs the full project folder path; a bare id opens nothing.
- Stop a host with `kill -9` of its own PID. A plain `kill` can leave the main process alive and the relaunch exits silently.

### Webview harness

The reader and the list panel are verified in a real browser:

1. Stub `vscode` through `Module._load`, then bundle and call the HTML builders (reader shell, list panel shell) to get the real HTML.
2. Map `asWebviewUri` to a local static server that serves the repository and `pdfjs-dist`.
3. Inject a `:root{--vscode-*}` block with the Dark or Light Modern values.
4. Inject an `acquireVsCodeApi` stub under the page's CSP nonce. It records `postMessage` calls and answers the reader's `ready-for-init` with `init`, or the list's `ready` with `navigate` and `snapshot` ([library-ui-host.md](../contracts/library-ui-host.md)).
5. Drive the page over CDP: click element centres with `Input.dispatchMouseEvent`; modifiers are Alt=1, Ctrl=2, Meta=4, Shift=8, and `boot.isMac` follows the host, so chords need Meta; assert on the DOM and the recorded messages; read the screenshots (crop with `sips -c H W --cropOffset Y X`).

Blind spots of the CDP harness:

- **Text-layer alignment.** Aiming at a span's own bounding box always hits, even when the text layer is misaligned with the ink. Outline `.textLayer span` in a screenshot and assert that the canvas, `.textLayer` and `.annotationLayer` boxes are identical.
- **A perfectly still pointer.** No real hand is. Simulate tremor by moving 1 px every ~40 ms, or timer-reset bugs stay invisible.
- **Pointer resting on content.** Park the idle pointer on a margin with no page content.

## Browser

### Build and load

```bash
pnpm --filter @labshelf/browser build            # both targets → dist/chrome, dist/firefox
pnpm --filter @labshelf/browser build:chrome     # or build:firefox
pnpm --filter @labshelf/browser lint:manifest    # web-ext lint on dist/firefox
```

- Chrome / Chromium 125+: `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`.
- Firefox 128+: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/firefox/manifest.json`, or `pnpm --filter @labshelf/browser dev:firefox`. A permanent install needs Developer Edition, Nightly or ESR with `xpinstall.signatures.required=false`; release Firefox needs `web-ext sign --channel=unlisted`.

To show the scratch copy in the Library page, pick the folder in Chromium or install the bridge ([bridge.md](../contracts/bridge.md)); Firefox cannot open folders, so only the bridge reaches one. A browser-storage library shows nothing from the copy.

### Headless run

Playwright's full Chrome for Testing loads the unpacked extension. Run it outside the sandbox:

```bash
"~/Library/Caches/ms-playwright/chromium-<ver>/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  --headless=new --load-extension=<repo>/packages/browser/dist/chrome \
  --disable-extensions-except=<same> --remote-debugging-port=0 --user-data-dir=<scratch>
```

- The DevTools port is in `<user-data-dir>/DevToolsActivePort`. Node has a global `WebSocket`, so the protocol needs no dependency.
- Pick the extension's service worker by `url.endsWith("/background/index.js")`; Chrome for Testing ships a component extension whose worker comes first. Read `chrome.storage.local` by evaluating in that worker.
- To test a page without the background, serve `dist/chrome` statically and inject a callback-style `window.chrome` stub (webextension-polyfill needs only `runtime.id`). Seed IndexedDB `labshelf` v1 on the same origin before navigating to `library-page/index.html`, which mounts core's library UI over an in-page loopback ([library-ui-host.md](../contracts/library-ui-host.md)) and the Details pane over a second one ([details-host.md](../contracts/details-host.md)).
- Search-page content script: `Fetch.enable` for `https://scholar.google.com/scholar*` or `https://www.google.com/search*` and fulfil the request with fixture HTML.
- Popup against an article tab: open `popup/index.html` in a 340 px target, overriding `chrome.tabs.query` through `Page.addScriptToEvaluateOnNewDocument`.
- Reader parity with VS Code: render both readers on the same real paper and pixel-diff the toolbar and sidebar. CDP drags create no text selection in either reader; select with a `Range` plus a synthetic `mouseup`.

A headless run cannot reach: downloads from Cloudflare-protected publishers (ACM, SIAM, ScienceDirect), which block headless browsers and plain `fetch` (test by hand); a click on a `web+labshelf:` link, because Chrome's protocol-handler registration needs the user's approval in a headed browser (`library-page/index.html?link=<link>` exercises the resolution, [links.md](../contracts/links.md)); calendar import and theme appearance.

### Collaboration against a local relay

Relay URLs must be `https:`, so a local relay needs TLS and no Cloudflare account.

- Bundle the Worker with `bundleRelayWorker` from `packages/core/tools/relayWorker/`. Run it with `wrangler dev --local --local-protocol https --ip 127.0.0.1 --persist-to <scratch>`, binding the Durable Object `ROOM` (class `Room`, `new_sqlite_classes`) and a KV namespace `KV`, with `OWNER_SECRET` in `.dev.vars`.
- Launch Chromium with `--ignore-certificate-errors` (it covers `wss`) and `--no-proxy-server`. Set `NO_PROXY=127.0.0.1,localhost` for Node tooling.
- Seed the owner profile's relay account in IndexedDB `labshelf-relay-account` (store `secrets`, key `account`) as the JSON of `{accountId, relayUrl, ownerSecret, kvNamespaceId, credential:{kind:"token", token}}`. A local relay needs no Cloudflare API call; the joining profile needs no account.
- Join in a second profile at `library-page/index.html#/join/<invite>`. Read the `labshelf` and `labshelf-collab` databases to check stored content.

### Headless Firefox

Drive stock Firefox through geckodriver; Playwright's Firefox needs its patched build.

- Start geckodriver with `--allow-system-access`; without it, extension pages are unscriptable.
- Run Firefox with `-headless` and the pref `extensions.webextensions.uuids={"labshelf@lucanaasser.dev":"<fixed uuid>"}` so the page URL is known. Install `dist/firefox` as a temporary add-on.
- Navigation to `moz-extension://` is refused. Load an http page, then set `location.href` to `moz-extension://<uuid>/library-page/index.html` from `executeScript`. Only web-accessible pages open this way.

### Chrome DevTools MCP

The project-scope `.mcp.json` registers `chrome-devtools-mcp` (headless, isolated profile, extension tools on), so an agent can inspect the unpacked extension without a CDP harness:

1. `pnpm --filter @labshelf/browser build:chrome`.
2. `install_extension` with the absolute `packages/browser/dist/chrome` path returns the extension id.
3. `new_page` on `chrome-extension://<id>/popup/index.html` (or `library-page/`, `options/`), then `take_snapshot` and `take_screenshot` with the page id `new_page` lists. `reload_extension` after a rebuild.

- Extension tools need the launched-browser (pipe) connection, so `--browserUrl`, `--wsEndpoint` and `--autoConnect` cannot be used with them.
- File arguments must lie under the repo or the OS temp directory.
- A server added to `.mcp.json` is available after the next session start and asks for approval on first use.
- Without an MCP client, drive the server over stdio: spawn the `.mcp.json` command, send `initialize` (declare the `roots` capability and answer `roots/list`), `notifications/initialized`, then `tools/call`.

## Terminal

### Build and run

```bash
pnpm --filter @labshelf/terminal build      # → packages/terminal/dist/labshelf.mjs (+ thumbnailWorker.mjs)
ln -s "$PWD/packages/terminal/dist/labshelf.mjs" /opt/homebrew/bin/labshelf
labshelf doctor                             # checks library, config and the image protocol
```

The library comes from `--library`, then `LABSHELF_LIBRARY`, then the shared config ([library-format.md](../contracts/library-format.md#shared-configuration)). Thumbnails need kitty, Ghostty, iTerm2 or WezTerm; in the VS Code terminal set `terminal.integrated.enableImages` and `LABSHELF_IMAGES=iterm`; inside tmux images are off unless forced. The first import of a scan or broken-font PDF downloads Tesseract's English data into the cache folder, so it needs the network once.

### Verification

Rebuild first (`node build/build.mjs`). Put the isolation in a wrapper script, because zsh does not word-split `$VAR` commands:

```bash
cp -R ~/LabShelf <scratch>/lib
XDG_CONFIG_HOME=<scratch>/config XDG_CACHE_HOME=<scratch>/cache LABSHELF_TOKEN_STORE=file \
  node packages/terminal/dist/labshelf.mjs -L <scratch>/lib "$@"
```

- **Text frames.** `--dump-frame 120x30 --keys "hjl<tab><enter><C-d>"` renders one frame as plain text through the real app and input decoder, with no TTY. A space in `--keys` is a key press.
- **Real pty.** A small Python `pty.fork()` harness (run Python with `-I`) sets the window size with `TIOCSWINSZ`, writes keys with delays and captures the bytes. Check the alternate screen in and out (`\x1b[?1049h` / `\x1b[?1049l`), the cursor restored (`\x1b[?25h`) and, with `LABSHELF_IMAGES=iterm`, the `\x1b]1337;File=` image escapes.
- **With VS Code.** Mark a status in the terminal and confirm `metadata.yaml` changed only in `status`; with VS Code open on the same copy, its list updates within a second.

### LabShelf Helper

The helper builds LaTeX projects for the browser extension over native messaging ([helper.md](../contracts/helper.md)) and shares nothing at run time with the `labshelf` command.

```bash
pnpm --filter @labshelf/terminal build              # → dist/labshelf-helper.mjs, run with Node
pnpm --filter @labshelf/terminal build:helper-sea   # → dist/sea/labshelf-helper-<os>-<arch>, a single executable that answers `hello`
```

Its data and logs live in the per-user data folder ([helper.md](../contracts/helper.md#data-folder)); on macOS and Linux that follows `HOME` (and `XDG_DATA_HOME` on Linux), so a run with a scratch `HOME` stays isolated. To verify against the unpacked extension, use Chrome for Testing and never the user's browser:

1. Build the helper and the extension (`pnpm --filter @labshelf/browser build:chrome`).
2. Write a wrapper script, because the manifest `path` must be an executable without arguments:
   ```bash
   #!/bin/sh
   HOME=<scratch>/home exec node <repo>/packages/terminal/dist/labshelf-helper.mjs "$@"
   ```
3. Put a manifest for `dev.labshelf.helper` at `<user-data-dir>/NativeMessagingHosts/dev.labshelf.helper.json` with `path` the wrapper ([manifest format](../contracts/native-host.md#manifests)). The manifest's `key` gives the unpacked extension the allowed id.
4. Launch Chrome for Testing as in [Browser: headless run](#headless-run) with `--user-data-dir=<user-data-dir>` and open `options/index.html`. The helper's frames are in `<scratch>/home/Library/Application Support/LabShelf Helper/logs/`.

## Spaces

Check in VS Code and the browser; automated tests do not establish visual acceptance. Use a scratch library with papers in several reading statuses and a writing project with checklist items and a deadline, plus a second copy to compare after destructive actions. The browser Library page must open the same scratch folder, because browser storage cannot show cross-app refresh.

- **Files.** After create, add, folder, remove and delete actions, compare `spaces/<id>/space.json` and `papers/` with the copy: references never copy or move a paper, and a deleted Space directory goes to trash ([spaces.md](../contracts/spaces.md)).
- **Missing references.** Add an unresolved paper id and project id by hand: the page offers Remove and a reload leaves the ids on disk until the user removes them.
- **Conflict copies (VS Code).** Create copies of both Space files with the [supported names](../contracts/library-format.md#conflict-copies), run Resolve Conflicting Copies, and check the chosen content survives and Keep both is absent.
- **Outside edits.** Edit a Space's name and glossary in the files or in the other app while it is open; both hosts refresh, including catalog and sidebar.
- **Calendar export.** Export `.ics` and import it into a calendar to inspect titles and dates.
- **Unavailable controls.** Interact with Notes, Discussions, Discover, Research chat, Share and Members while watching network activity: no capability request leaves the app.
- **Appearance and keyboard.** Light and dark themes, narrow panels, focus rings, keyboard use of the sidebar tree and inner tabs with the right roles in the accessibility tree, reduced motion, and row actions by pointer, keyboard and touch. Compare proportions with the [mockup](../ideas/spaces-mockup/index.html).
- **Browser pane.** Switch Details and Research chat, resize and collapse the pane, reload: mode, width, collapsed state and the inner tab persist.

## Website

`pnpm --filter @labshelf/website build` bundles the demos that mount core UI, and the `/share/` page that opens a [share link](../contracts/share-link.md), into `website/dist/`. Serve `website/` with a static server (`npx serve website`); the demos are ES modules, which browsers do not load from `file://`.

Demos and recordings use `website/demo-library/`, which commits one PDF (licences in its `LICENSES.md`). `node website/tools/fetchDemoLibrary.mjs <dest>` copies it and downloads the other PDFs from arXiv. Record against that copy, never the committed folder.
