# Session 1 — Spikes: reuse, WebRTC host, signalling, Cloudflare API, campus networks

- **Goal:** the open technical premises of the plan are answered with evidence, so sessions 2–8 build on facts.
- **Starts from:** plan approved; plan `folder-sync` committed.
- **Ends with:** research entries updated or written; no product code. Prototype code lives in scratch dirs outside the repo and is deleted.
- **Owns:** `documents/plans/project-collaboration/research/**`, `documents/plans/project-collaboration/log.md` (append).

Context: LabShelf shares LaTeX/Typst project folders between users, live in VS Code, P2P over WebRTC (trystero) with end-to-end encryption, optional relay on the owner's own Cloudflare account. Facts so far: `research/reuse-and-transport.md`, `research/cloudflare-free-plan.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1.1 | Binding reuse decision | task | general-purpose (opus), web + clone in scratch | entry has a decision | [ ] |
| 1.2 | WebRTC in the extension host | task | general-purpose (opus), scratch extension | entry has a decision | [ ] |
| 1.3 | Signalling reliability | task | general-purpose (sonnet), scratch script | entry has numbers | [ ] |
| 1.4 | Cloudflare API deploy | task | main thread with the user (scratch account, user-made token) | entry has a working recipe | [ ] |
| 1.5 | Campus-network P2P check | task | the user runs the 1.3 script on a university network | result in entry | [ ] |
| 1.6 | Commit research | — | `git commit` of Owns | committed | [ ] |

1.1–1.3 in parallel (disjoint scratch dirs, each writes its own section of `reuse-and-transport.md`, or its own entry); 1.4 and 1.5 need the user.

## 1.1 — Binding reuse decision

- **Goal:** decide how LabShelf binds a Yjs `Y.Text` to a VS Code `TextDocument`.
- **Read only:** `research/reuse-and-transport.md`; https://github.com/eclipse-oct/open-collaboration-tools (`yjs-normalized-text.ts`, the VS Code extension's document sync and cursor decorations); https://github.com/kermanx/p2p-live-share (`src/fs/`, `src/sync/`, `src/fs/undo-manager.ts`).
- **Decided:** criteria: licence (both reported MIT; confirm per file headers, EPL dual licences), published as an npm library or not, coupling to their session/transport, CRLF and echo handling, undo, test coverage. Output: "import <pkg>", "copy <files> with notice into `packages/core/src/collab/`", or "write own", with the list of functions LabShelf needs.
- **Done when:** a "Binding decision" section with sources and line counts.

## 1.2 — WebRTC in the extension host

- **Goal:** pick where `RTCPeerConnection` runs for VS Code.
- **Read only:** p2p-live-share `src/sync/trystero/index.ts`, `src/webview/index.ts`; `node-datachannel` README.
- **Decided:** compare (a) a webview carrying trystero, talking to the extension host over `postMessage` (p2p-live-share's way): does it stay alive with every LabShelf view hidden or closed (`retainContextWhenHidden`, a resolved `WebviewView`)? throughput for a 5 MB blob; (b) `node-datachannel` in the extension host: VSIX size per platform, platform-specific packaging. Prototype each in a scratch extension run in a `@vscode/test-electron` copy with its own user-data-dir (ask the user first; never kill VS Code by name).
- **Done when:** "WebRTC host" section with the decision and the measured numbers.

## 1.3 — Signalling reliability

- **Goal:** know how fast and how often two trystero peers meet.
- **Decided:** a Node script with `node-datachannel` polyfill or two headless Chromium pages; 30 joins per strategy (Nostr, BitTorrent, MQTT) with fresh room ids; record time to first connection and failures; check that the room password keeps a third peer out.
- **Done when:** "Signalling" section with a table and the chosen strategy and relay URLs.

## 1.4 — Cloudflare API deploy

- **Goal:** a verified recipe for deploying and updating a Worker with a Durable Object (SQLite, migration tag), a KV namespace and a secret, using only HTTP calls with a user token.
- **Steps (main thread):** the user creates a scratch Cloudflare account and a token (record the template and permissions that worked); upload a 30-line echo Worker with a DO and KV binding; update it; mint a TURN credential; read `/version`. Re-check every limit in `research/cloudflare-free-plan.md` against the official pages and note the ToS on several accounts and whether a card is asked for. Delete the token and the scratch Worker after.
- **Done when:** `research/cloudflare-free-plan.md` has the request sequence (URLs, multipart parts, metadata JSON) and corrected limits with links.

## 1.5 — Campus-network check

- **Goal:** know whether direct P2P works on the networks the users have.
- **Steps:** the user runs the 1.3 script between home and a university network, then with the 1.4 TURN credential.
- **Done when:** results (direct / TURN only / blocked, `workers.dev` reachable or not) are in "Signalling".
