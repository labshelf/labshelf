# Session 1 — can an extension page reach the helper's socket

- **Goal:** answer, with a run in each browser, whether an extension page can open a WebSocket to 127.0.0.1 and what the helper sees as `Origin`.
- **Starts from:** plan approved.
- **Ends with:** `documents/plans/browser-project-workspace/research/transport-spike.md` with the answer per browser and the fallback that session 5 builds; no repo code changed.
- **Owns:** `documents/plans/browser-project-workspace/research/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1.1 | Spike in a scratch dir | task | implementer (opus) | the research note answers every question below | [ ] |
| 1.2 | Commit | — | `git commit` of the research file | committed | [ ] |

## 1.1 — Spike

- **Goal:** measured facts on extension page → `ws://127.0.0.1:<port>` in Chrome (stable and Chrome for Testing) and Firefox (Developer Edition, fresh `-profile`, `-no-remote`).
- **Read only:** `documents/contracts/helper.md` (Transport); `documents/contracts/native-host.md` (Manifests); `packages/browser/manifest.chrome.json`, `manifest.firefox.json` (permissions, CSP); `packages/browser/src/helper/client/connection/` (how the page opens the native port).
- **Decided:** all code lives in the scratchpad, outside the repo: a 30-line Node `ws`-free server (`node:http` upgrade) that logs `Origin` and headers, and an unpacked extension with one page. Questions: (1) does Chrome's Local Network Access prompt or block a loopback socket from a `chrome-extension://` page, with and without `host_permissions` for `ws://127.0.0.1/*`; (2) the exact `Origin` header in Chrome and Firefox (Firefox: is it `moz-extension://<uuid>`, and can the page read its own uuid with `location.origin` to send it over native messaging); (3) does the manifest CSP `connect-src` need a change; (4) round-trip latency of a 64 KiB binary frame vs one native-messaging frame of the same payload (base64). The fallback, if a browser blocks the socket: that browser keeps every message on native messaging with the same message set. Never launch the user's installed Chrome or Firefox windows; use separate binaries and profiles, stop only launched PIDs.
- **Done when:** the note answers (1)–(4) per browser with versions and numbers, states the manifest changes session 5 needs, and lists what was not checked.
- **Do not touch:** anything in `packages/`, the user's browser profiles.
