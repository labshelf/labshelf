# Session 10 — Relay-only collaboration, Cloudflare sign-in and the real-run fixes

- **Goal:** every shared project syncs through Cloudflare relays only, a user connects Cloudflare by signing in once in the browser, and the gaps found by the real runs of 6.6, 7.3 and 8.6 are closed.
- **Starts from:** sessions 6, 7 and 8 committed (6.7, 7.4, 8.7).
- **Ends with:** A7, A8, A9, A10, A13 on real accounts.
- **Owns:** `packages/core/src/collab/transport/`, `packages/core/src/collab/node/rtc/` (deleted), `packages/core/src/collab/relays/`, `packages/core/src/relay/` (worker TURN parts, deploy), `packages/core/src/share/dom/` (read-only page controls), their tests under `packages/core/__tests__/`, `packages/vscode/src/relay/`, `packages/vscode/src/collab/` (share/join glue), `packages/{core,vscode}/package.json` and the lockfile, `documents/contracts/{collaboration,relay}.md`, `documents/plans/browser-editor/**`, `research/cloudflare-free-plan.md`.

Runs alone (manifests, lockfile).

Context: decisions D4, D9, D10 and D20 in the plan as revised on 2026-10-18; the OAuth facts and the request sequence in `research/cloudflare-free-plan.md`; the 7.3 run results in `log.md` (2026-10-18 · 7.3).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 10.1 | Remove P2P and TURN | contract | implementer (opus), tests first → `architecture-reviewer` | relay-only tests, no trystero/node-datachannel/turn left | [ ] |
| 10.2 | Cloudflare sign-in (OAuth + refresh) | contract | implementer (opus), tests first | sign-in tests | [ ] |
| 10.3 | Share requires a connected relay | behaviour | implementer (sonnet) | typecheck | [ ] |
| 10.4 | Relay health re-probe | contract | implementer (opus), tests first | partition test | [ ] |
| 10.5 | One snapshot writer, typed ticket refusals | behaviour | implementer (sonnet), tests first | snapshot and ticket tests | [ ] |
| 10.6 | Share page shows no editing controls | behaviour | implementer (sonnet) | headless check | [ ] |
| 10.7 | browser-editor plan follows the relay-only protocol | task | main thread | plan text | [ ] |
| 10.8 | Real run | task | main thread with the user's accounts A and B | A7–A10, A13 | [ ] |
| 10.9 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

10.1 first; 10.2, 10.4 and 10.5 in parallel (disjoint: `vscode/src/relay/` + `relay/deploy/`, `collab/relays/`, `collab/transport/relay/`); 10.3 after 10.2; 10.6 and 10.7 any time.

## 10.1 — Remove P2P and TURN

- **Read only:** `collab/transport/{index.ts,peerTransport.ts}`, `collab/transport/trystero/**`, `collab/transport/relay/mergeTransports.ts`, `collab/node/rtc/**`, `relay/worker/turnCredentials.ts`, `relay/deploy/turnKey.ts`, `documents/contracts/{collaboration,relay}.md`.
- **Decided:**
  - The relay transport is the only `PeerTransport`. Delete the trystero transport, Nostr signalling, `node-datachannel`, the rtc host, `mergeTransports`, and the `@trystero-p2p/nostr` and `node-datachannel` dependencies of core and vscode.
  - Awareness (cursors, selections) travels over the relay, forwarded and never stored, throttled to at most one message per client every 250 ms; the 6.3 budget test includes it and still stays under 2,000 requests for an hour of three typists.
  - TURN goes: the Worker's `/turn` route and TURN secrets, `createTurnKey`/`deleteTurnKey`, the `turnKeyId` of a deployed relay and the `realtime.write` scope. The relay protocol bumps its version as `relay.md`'s rules require for a removed endpoint.
  - Delete what this makes unused, including docs of P2P behaviour.
- **Done when:** tests first: two and three clients converge, catch up and exchange awareness through a fake relay only; `rg -i 'trystero|datachannel|turn'` in `packages/` finds no live reference; core and vscode typecheck and test.

## 10.2 — Cloudflare sign-in

- **Read only:** `research/cloudflare-free-plan.md` (OAuth section), `vscode/src/relay/{connectRelay,disconnectRelay,updateRelayOnStart,relayAccounts}.ts`, `relay/deploy/api/cloudflareClient.ts`.
- **Decided:**
  - Authorization Code + PKCE (`S256`), public client `6bf60d8231e753c5249c7044aa0c4aff`, redirect `http://127.0.0.1:8976/callback` (registered exactly), scopes `workers-scripts.admin workers-kv-storage.write account-settings.read offline_access`. The runtime-neutral parts (URL, PKCE, token exchange, refresh) live in core `relay/deploy/`; the loopback listener and `vscode.env.openExternal` live in vscode.
  - The loopback page answers with a redirect to `https://labshelf.org/connected/?service=cloudflare`, or `&error=<code>` on failure; it never renders tokens or codes.
  - Tokens live in `SecretStorage`. Every refresh rotates the refresh token: the new one is written before the access token is used, and a lock in `SecretStorage` lets one VS Code window refresh at a time (two refreshes with one token can revoke the grant).
  - LabShelf refreshes on start when the bundled Worker is newer than `/version` and whenever it needs the API; a refused refresh asks the user to sign in again and logs why.
  - The user removes `realtime.write` ("Realtime") from the client's scopes in the dashboard; until then the client may still list it.
  - "Connect Cloudflare…" signs in. Pasting a token stays as the fallback for remote hosts (SSH, Codespaces), where the browser cannot reach the loopback port.
- **Done when:** tests first against a fake OAuth server: PKCE and state checked, code exchange, refresh rotation stored, a stale refresh token refused and surfaced, concurrent refresh serialised; vscode typecheck and build.

## 10.3 — Share requires a connected relay

- **Decided:** "Share Project…" without a connected Cloudflare account runs "Connect Cloudflare…" first and offers the relay in the invite; cancelling it cancels sharing with a message that says why. "Join Shared Project…" with an invite that carries no relay refuses with a typed error.
- **Done when:** vscode typecheck. No test: glue.

## 10.4 — Relay health re-probe

- **Read only:** `collab/relays/{followRelaySelection,relayHolds,relayProbe,relaySelector,observedConnection,switchableTransport}.ts`.
- **Decided:**
  - Found in 7.3: a relay that refuses new connections but keeps old sockets alive splits the group. Old clients stay on it; a newcomer skips it, lands on the next relay and sees an empty project, and presence cannot heal the split because it travels over the relay.
  - Every client re-probes the relay it uses with `/version` every 60 s while connected. A 429 or a 1027 page marks it down at once; another failure retries after 20 s, and three failures in a row mark it down. A down mark moves the client as a socket close does, so the group converges on the next relay.
  - A newcomer that skipped a relay keeps probing the skipped ones on the same schedule, so it rejoins the group when the relay answers again.
- **Done when:** tests first with fake relays and a fake clock: relay A refuses new sockets while old ones live → within 3 minutes every client is on B and the newcomer's and old clients' edits converge; a 1027 page moves everyone at the next probe; the budget test with probes stays under 2,000 requests per hour.

## 10.5 — One snapshot writer, typed ticket refusals

- **Decided:**
  - Found in 7.3: at 500 updates every client writes a snapshot at the same cursor and the relay refuses the copies with `staleSnapshot`. Only the client with the lowest awareness id among those connected writes it; a `staleSnapshot` refusal is logged at debug and is not a failure.
  - Found in 7.3: a 5xx or non-JSON answer from `/ticket` is a `relayDown` refusal with the status in the log, not a `network` error from a JSON parse; it counts toward the three-failure hold.
- **Done when:** tests first: three clients reach 500 updates and the relay receives one snapshot; a 503 HTML `/ticket` answer gives `relayDown`.

## 10.6 — Share page shows no editing controls

- **Decided:** found in 8.6: the read-only share page shows the library's "+ Add" button and an editable input besides search. The read-only mode hides "+ Add" and every editing input; search stays.
- **Done when:** the headless check of 8.4 shows the list without "+ Add" and with search as the only input.

## 10.7 — browser-editor plan

- **Do:** update `documents/plans/browser-editor/**` so the browser editor joins shared projects through the relay only (no WebRTC), keeping its file limits (A12).

## 10.8 — Real run

- **Do:** with accounts A (`labshelf@proton.me`) and B (`lucaanasser@gmail.com`), through the extension host: sign in with "Connect Cloudflare…" in both (A13); share, check A8 and that sharing without a connection asks for one (A9); stop relay A with a Worker that answers 503 while old sockets stay open, and check every client and a newcomer end on B with all edits (A10); dump the relay for A7. Clean both accounts afterwards; leave `labshelf-website`.
