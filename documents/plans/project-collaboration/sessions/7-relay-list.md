# Session 7 — Relay list and failover

- **Goal:** a project carries a list of relays from members who connected Cloudflare, and every client uses the same one and fails over together.
- **Starts from:** session 6 committed.
- **Ends with:** A10.
- **Owns:** `packages/core/src/collab/relays/`, `packages/core/__tests__/collab/relays/`, the relay-list section of `documents/contracts/collaboration.md`, the "Offer my relay" command entry and glue in `packages/vscode/src/relay/`.

Runs alone (manifest).

Context: CRDT state lives in clients, so relays are interchangeable; pooling relays only adds capacity this way (relay federation does not). Budget and limits: `documents/plans/project-collaboration/research/cloudflare-free-plan.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 7.1 | Relay list and selection | contract | implementer (opus), tests first → `architecture-reviewer` | selection tests | [x] |
| 7.2 | "Offer my relay" in VS Code | behaviour | implementer (sonnet) | typecheck | [x] |
| 7.3 | Two-relay run | task | main thread with the user's scratch accounts | A10 | [ ] |
| 7.4 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 7.1 — Relay list and selection

- **Read only:** `research/cloudflare-free-plan.md`; `documents/contracts/{collaboration,relay}.md`; the session-6 relay transport; the 2.2 index-doc API.
- **Decided:**
  - The list lives in the index doc (`relays: Y.Array<{url, addedBy, relayToken}>`), encrypted like the rest, and in the invite link (2.1).
  - Order is the list order; a client uses the first relay that answers `/version` within 3 s and reports it in awareness.
  - A relay that refuses for limits (HTTP 429 or a quota error), or fails three times, is marked down for one hour in awareness; clients that see a peer move follow it, so the group converges on one relay.
  - On switching, the client writes a fresh snapshot to the relay it moves to, so catch-up works there.
  - A member removes only their own relay.
- **Done when:** tests first with fake relays: all clients pick the same relay; on a 429 all move to the next and no edit is lost; a recovered relay is used again after the hold.

## 7.2 — "Offer my relay"

- **Decided:** command `labshelf.relay.offer` adds the user's connected Worker to the open shared project's list; `labshelf.relay.withdraw` removes it. The status bar item names the relay in use.
- **Done when:** vscode typecheck passes. No test: glue.

## 7.3 — Two-relay run

- **Do:** two scratch accounts' Workers in one project; stop the first (delete its route) mid-session; check every client moves and no edit is lost (A10).
