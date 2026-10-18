sha: 879cee10
files: packages/browser/manifest.chrome.json, packages/browser/manifest.firefox.json, documents/contracts/helper.md#transport
source: session 1 spike (scratch Node `node:http` upgrade echo server + unpacked one-page extension + Node native messaging echo host), macOS arm64, 2026-10-18

## Runs
- Chrome for Testing 156.0.8078.4 (Playwright chromium-1248), headed, fresh `--user-data-dir`, `--load-extension`, host manifest in `<user-data-dir>/NativeMessagingHosts/`. Variants: LabShelf permissions + CSP; no `host_permissions`; only `ws://127.0.0.1/*`.
- Firefox Developer Edition 159.0 (build 20261016090327), fresh `-profile`, `-no-remote`, unsigned XPI sideloaded into the profile. Variants: LabShelf permissions + CSP (with `upgrade-insecure-requests`); no CSP key (Firefox MV3 default CSP); CSP without `upgrade-insecure-requests`; only `ws://127.0.0.1/*`.
- Latency: 5 warm-up + 50 timed round trips of 64 KiB random bytes. WebSocket sends one binary frame that the server echoes. Native messaging sends `{type, data: base64}` (87,409 bytes of JSON), which the host echoes. Timings include base64 encode/decode unless marked otherwise.

## (1) Local Network Access
- Chrome: no prompt and no block in any variant, with or without `host_permissions`. `navigator.permissions.query({name: "local-network-access"})` reports `prompt` from the extension page, but the socket opens anyway. Repeat runs open in 1–2 ms. The first two runs on fresh profiles took 11.7 s and 3.1 s to open, with no user action; the cause was not determined.
- Firefox: `local-network-access` is not a permission name; `loopback-network` reports `prompt`, and nothing prompted. The socket opens in 5 ms only when the CSP has no `upgrade-insecure-requests` (see 3).

## (2) Origin header
- Chrome: `Origin: chrome-extension://<id>`. The id is fixed by the manifest `key`, so the helper can check it against a constant.
- Firefox: `Origin: moz-extension://<uuid>`. The uuid is random for each profile install and equals the page's `location.origin`, so the page can read it and send it over native messaging before it opens the socket.

## (3) CSP
- Chrome: no change needed. Without `connect-src`, the LabShelf CSP allows `ws://127.0.0.1`.
- Firefox: `upgrade-insecure-requests` (in the LabShelf CSP and in Firefox's MV3 default) rewrites `ws://127.0.0.1` to `wss://`. The handshake fails with close code 1015 (TLS) after 24–39 ms, and `host_permissions` for `ws://127.0.0.1/*` do not help. Removing the directive from `extension_pages` makes the socket work. Adding `connect-src` is not needed.

## (4) Latency, 64 KiB round trip (median / p95, ms)
| | WebSocket binary | Native messaging, base64 | Native messaging, without encode/decode |
|---|---|---|---|
| Chrome 156 | 0.2–0.3 / 0.4–0.5 | 1.6–1.9 / 2.0–8.6 | 0.5–0.6 / 0.6–1.5 |
| Firefox 159 | 2 / 25 | 2–3 / 16–24 | 1 / 1–2 |

Firefox clamps `performance.now()` to 1 ms, so its rows only show that the two transports are of the same order.

## Manifest changes for session 5
- `manifest.firefox.json`: `extension_pages` becomes `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`, without `upgrade-insecure-requests`. Check first that nothing in the page depends on the upgrade: the page's fetches go to `https://` APIs, and `http://` PDF links would no longer be upgraded.
- `manifest.chrome.json`: none. Neither manifest needs `host_permissions` for `ws://127.0.0.1/*`.
- Origin check in the helper: a fixed `chrome-extension://<id>` for Chrome. For Firefox, the `moz-extension://<uuid>` that the page sends over native messaging, because the uuid cannot be known at install time.
- No browser blocked the socket, so neither browser needs the native-messaging-only fallback. It stays the answer if the Firefox CSP change is rejected.

## Not checked
- Branded Chrome stable: not launched (it is the user's daily browser, and branded Chrome ignores `--load-extension`). Chrome for Testing stands in for it, and a field-trial or enterprise LNA policy in stable could differ.
- Whether the slow first opens on fresh Chrome profiles (11.7 s, 3.1 s) come from an LNA check. The spike recorded no screen.
- Firefox release channel, Windows, Linux, `ws://localhost`, and a packaged or signed Firefox add-on (the spike sideloaded an unsigned XPI).
- Firefox without the 1 ms timer clamp.
