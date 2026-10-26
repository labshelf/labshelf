# Browser

The installed Google Chrome crashes headless on this Mac: use Playwright's Chrome for Testing or its headless shell, outside the sandbox. Firefox cannot open folders, so only the bridge reaches a library folder there. A permanent Firefox install needs Developer Edition, Nightly or ESR with `xpinstall.signatures.required=false`; release Firefox needs `web-ext sign --channel=unlisted`.

## Headless run

Chrome for Testing loads the unpacked extension with `--headless=new --load-extension=<dist> --disable-extensions-except=<dist>`.

- It ships a component extension whose service worker comes first; pick LabShelf's worker by its URL.
- Fulfil search-engine requests with fixture HTML through `Fetch.enable`.

A headless run cannot reach: downloads from Cloudflare-protected publishers (ACM, SIAM, ScienceDirect), which block headless browsers and plain `fetch` (test by hand); a click on a `web+labshelf:` link, because Chrome's protocol-handler registration needs the user's approval in a headed browser; calendar import and theme appearance.

## Collaboration against a local relay

Relay URLs must be `https:`, so a local relay needs TLS and no Cloudflare account: run the Worker with `wrangler dev --local --local-protocol https`. Launch Chromium with `--ignore-certificate-errors` (it covers `wss`) and `--no-proxy-server`, and set `NO_PROXY=127.0.0.1,localhost` for Node tooling. Join from a second browser profile.

## Headless Firefox

Drive stock Firefox through geckodriver; Playwright's Firefox needs its patched build.

- Start geckodriver with `--allow-system-access`; without it, extension pages are unscriptable.
- Run Firefox with `-headless` and the pref `extensions.webextensions.uuids` set to a fixed uuid for the extension id, so the page URL is known. Install the add-on as temporary.
- Navigation to `moz-extension://` is refused. Load an http page, then set `location.href` to the extension page from `executeScript`. Only web-accessible pages open this way.

## Chrome DevTools MCP

- Extension tools need the launched-browser (pipe) connection, so `--browserUrl`, `--wsEndpoint` and `--autoConnect` cannot be used with them.
- File arguments must lie under the repo or the OS temp directory.
