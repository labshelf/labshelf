# Session 3 — Encrypted P2P sync with reconnect

- **Goal:** two or more clients holding the same invite keep a project's docs in sync over encrypted WebRTC, with presence, catch-up after a disconnect and blob transfer.
- **Starts from:** session 2 committed.
- **Ends with:** core tests over fake transports pass for convergence, reconnect, wrong key and blobs; a trystero transport exists in `collab/dom/`. No app wiring.
- **Owns:** `packages/core/src/collab/sync/`, `packages/core/src/collab/transport/`, `packages/core/src/collab/dom/`, their tests under `packages/core/__tests__/collab/`, `packages/core/package.json` (`trystero`), the sync and awareness sections of `documents/contracts/collaboration.md`.

Runs alone (adds a dependency).

Context: design in `documents/plans/project-collaboration/research/collab-model.md`; transport facts and the WebRTC-host decision in `research/reuse-and-transport.md` ("WebRTC host", "Signalling", written in session 1).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Transport port and sync protocol | contract | implementer (opus), tests first → `architecture-reviewer` | convergence tests | [x] |
| 3.2 | Awareness and blobs | behaviour | implementer (sonnet), tests first | awareness/blob tests | [x] |
| 3.3 | trystero transport | behaviour | implementer (sonnet) | typecheck, one two-page check | [x] |
| 3.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [x] |

3.1 first; 3.2 and 3.3 in parallel (disjoint: `collab/sync/` awareness and blob files vs `collab/dom/`).

## 3.1 — Transport port and sync protocol

- **Goal:** a runtime-neutral session that syncs an index doc and file docs over any `PeerTransport`.
- **Read only:** `research/collab-model.md`; `research/reuse-and-transport.md` (ack/resend layer of p2p-live-share); the 2.1 frame API (`packages/core/src/collab/crypto/index.ts`); `packages/core/src/ports/` (an existing port, for style).
- **Decided:**
  - `PeerTransport` port: `peers`, `send(peer | all, bytes)`, `onMessage`, `onPeerJoin/Leave`, `close`. Implementations: fake (tests), trystero (3.3), relay WebSocket (session 6).
  - Messages are y-protocols sync step 1/2 and updates, per doc key, inside encrypted frames; message kinds and a protocol version byte are in the contract.
  - Per-peer ordering and resend with acks, as p2p-live-share does; a peer that rejoins runs sync step 1 for every doc (state vectors), so missed edits arrive.
  - Lazy docs: the index syncs first; file docs sync when opened or when the disk mirror needs them; all docs sync in the background at low rate.
  - A frame that fails to decrypt is dropped and logged through `ILogger` once per peer (wrong key or tampering), never applied.
  - More than 8 peers: the session reports `meshFull` and opens no further direct links.
- **Done when:** tests first with fake transports: three clients converge after random concurrent edits; a client offline during edits catches up on rejoin; a wrong-key peer changes nothing; dropped and reordered messages still converge. Core typecheck and tests pass.

## 3.2 — Awareness and blobs

- **Goal:** cursors/presence and binary files over the same session.
- **Read only:** `research/collab-model.md` ("Awareness", "Docs per project"); the 3.1 session API; `packages/core/src/hash/index.ts`.
- **Decided:** y-protocols awareness, encrypted with the `awareness` key, never persisted; state `{name, colour, file, anchor, head}`. Blobs: request by `sha256Hex`, 64 KiB encrypted chunks, verified by hash before they are handed out, any peer that has the hash answers.
- **Done when:** tests first: awareness reaches peers and expires on leave; a blob arrives intact from a peer and a corrupted chunk is rejected.

## 3.3 — trystero transport

- **Goal:** `PeerTransport` over trystero, in `collab/dom/` (runs in a webview or a browser page).
- **Read only:** `research/reuse-and-transport.md` ("Signalling", "WebRTC host"); the 3.1 port.
- **Decided:** strategy and relay URLs from the "Signalling" section; room id and password from the `room` key; TURN config injectable (session 6 supplies it); reconnect with backoff on transport loss, logged.
- **Done when:** core typecheck passes; two headless Chromium pages (Playwright headless shell) join one room and converge an edit. No unit test: third-party glue.
