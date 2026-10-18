# Session 6 — The owner's Cloudflare relay: Worker, API deploy, persistence, fallback, TURN

- **Goal:** a project owner pastes a Cloudflare API token once; LabShelf deploys and keeps updated a minimal Worker in the owner's account that stores encrypted updates and snapshots, relays over WebSocket and mints TURN credentials.
- **Starts from:** session 5 committed; session 1's Cloudflare recipe in `research/cloudflare-free-plan.md`.
- **Ends with:** A7, A8, A9.
- **Owns:** `packages/core/src/relay/` (`worker/`, `deploy/`, protocol at the root), `packages/core/__tests__/relay/`, the core build step that bundles the Worker script, `packages/core/src/collab/transport/relay*`, `packages/vscode/src/relay/`, the `labshelf.relay.*` entries in `packages/vscode/package.json`, `documents/contracts/relay.md`, the Worker-runtime rule in `documents/architecture.md`.

Runs alone (build script and manifest).

Context: limits, budget rules, auth and the deploy recipe: `documents/plans/project-collaboration/research/cloudflare-free-plan.md`. The relay never decodes Yjs; it stores and forwards frames encrypted by session 2's crypto.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 6.1 | Relay protocol and contract | contract | implementer (opus), tests first → `architecture-reviewer` | protocol tests | [x] |
| 6.2 | Worker | contract | implementer (opus), tests first (Miniflare or a fake DO) | Worker tests | [x] |
| 6.3 | Relay transport and batching in clients | behaviour | implementer (sonnet), tests first | budget tests | [x] |
| 6.4 | API deploy and update | behaviour | implementer (sonnet), tests first against a fake API | deploy tests | [x] |
| 6.5 | Token setup UI in VS Code | behaviour | `ui-design` first, then implementer (sonnet) | typecheck | [x] |
| 6.6 | Real account run | task | main thread with the user's scratch account | A7–A9 | [ ] |
| 6.7 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [x] |

6.1 first; 6.2, 6.3 and 6.4 in parallel (disjoint: `relay/worker/`, `collab/transport/relay*`, `relay/deploy/`); 6.5 after 6.4.

## 6.1 — Relay protocol and contract

- **Read only:** `research/cloudflare-free-plan.md`; `documents/contracts/collaboration.md` (frames); the session-3 `PeerTransport` port.
- **Decided:** every message carries `v` (major.minor); endpoints `/version`, `/claim`, `/ticket`, `/project/<shareId>` (WebSocket), `/turn`; a client talks to any Worker of the same major; minor additions are optional fields. Messages: `put {doc, frame}`, `since {doc, cursor}`, `snapshot {doc, frame, covers}`, `forward {frame}`. `relay.md` written before code, linked from `documents/README.md`.
- **Done when:** tests first: encode/decode, version negotiation, a newer minor talking to an older Worker.

## 6.2 — Worker

- **Decided:** one SQLite-backed Durable Object per shareId, WebSocket Hibernation API; stores frames and snapshots as rows (chunked under the row size), deletes rows a snapshot covers; auth: owner secret set at claim, relay-token hash per project, 5-minute HMAC tickets; TURN credentials minted with a short TTL. A few hundred lines; no Yjs import. Bundled by the core build into one script whose version is the protocol version.
- **Done when:** tests first: store and replay since a cursor, snapshot compaction, a bad ticket is refused, nothing in storage is plaintext (A7).

## 6.3 — Relay transport and batching

- **Decided:** `PeerTransport` over the relay WebSocket; writes batched per doc (at most one per 2 s while typing, flushed on idle and close); awareness forwarded, never stored; reconnect with backoff (runtime updates drop sockets); the client that holds full state writes a snapshot after 500 updates; TURN credentials passed to the trystero transport.
- **Done when:** tests first: a scripted hour of three typists stays under 2,000 relay requests (A8); a client offline during all edits catches up from the relay alone.

## 6.4 — API deploy and update

- **Decided:** the request sequence from session 1's recipe, over `fetch`; deploy on setup, then on every LabShelf start compare `/version` with the bundled version and upload when older; never downgrade; every call and failure logged without the token.
- **Done when:** tests first against a fake Cloudflare API: first deploy, update, no-op when current, readable error on a bad token.

## 6.5 — Token setup UI

- **Decided:** commands `labshelf.relay.connect` ("Connect Cloudflare…") and `labshelf.relay.disconnect`; a guide that links to the token page with the template from session 1; the token in `SecretStorage`; the relay URL added to the projects the user owns.
- **Done when:** vscode typecheck and build pass.

## 6.6 — Real account run

- **Do:** with the user's scratch account: connect, share, check A8 (catch-up with the owner offline, update on start, request count from the dashboard) and A9 on a network that blocks P2P; dump DO storage for A7.
