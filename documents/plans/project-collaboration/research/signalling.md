files: documents/plans/project-collaboration/research/signalling-probe.mjs (probe only; no product code)
source: measured 2026-10-17 with trystero 0.26.0 on one macOS machine, 30 joins per strategy

# Signalling

Two peers per join, each in a fresh headless Chromium context (trystero multiplexes rooms over one connection between the same two peers, so a reused page measures 5 ms). Time runs from `joinRoom` to the first `onPeerJoin`; the first message round trip adds 1 to 2 ms. The peers share one machine, so the numbers cover relay signalling only, not NAT traversal or TURN.

| Strategy | Joins | Successes | Median / p90 to peer | Failures |
|---|---|---|---|---|
| Nostr | 30 | 30 | 1,111 / 1,286 ms | none |
| BitTorrent | 30 | 30 | 913 / 1,018 ms | none |
| MQTT | 30 | 30 | 1,201 / 1,345 ms | none |

Strategies live in separate packages since 0.26: `@trystero-p2p/nostr`, `/torrent`, `/mqtt` (the `trystero` entry for torrent and mqtt only warns). Node with the `node-datachannel` polyfill does not complete a handshake, so the probe uses a browser: the polyfill fires `negotiationneeded` before trystero registers its handler, enters `have-local-offer` on `createDataChannel`, and ignores `setLocalDescription()` without arguments. The VS Code extension host needs a webview or a patched polyfill for the same reason.

## Relays used (default config, `appId: labshelf-probe`)
- Nostr connects to 5 of 29 default relays, chosen from a hash of `appId` (`relayConfig.redundancy`, default 5). Open at success: `relay.routstr.com`, `relay-dev.gulugulu.moe`, `relay.novospes.com` (30/30). Never open: `nostr.robosats.org`, `relay.bitmacro.cloud` (0/30). Another `appId` picks another five.
- BitTorrent connects to the first 3 of 5 trackers: `tracker.openwebtorrent.com` (30/30 open at success), `open.ftorrent.com` (20/30), `tracker.webtorrent.dev` (7/30, slow to connect). Others: `tracker.btorrent.xyz`, `tracker.files.fm:7073`.
- MQTT connects to all 4 brokers, 30/30 each: `broker.emqx.io:8084`, `broker.hivemq.com:8884`, `test.mosquitto.org:8081`, `public.cloud.shiftr.io`.

## Password check
A third peer joined the same room with `password: 'wrong'` while host and guest used `'correct'` (5 joins per strategy, 4 s grace after success). The intruder never reached `onPeerJoin` or received a message in 15 of 15 joins; the host and guest each saw exactly one peer. trystero reports `incorrect room password when decrypting offer` through `onJoinError`. Without `password`, session descriptions are encrypted with a key derived from `appId` and room id, so any peer that knows both can join: rooms need a password.

## Choice: Nostr
- Relays are `wss://` on port 443 except one (`:8443`), the port campus firewalls most often allow (not measured here); MQTT brokers use 8084, 8884 and 8081, and BitTorrent trackers are public hosts with no operator commitment.
- 29 default relays and `relayConfig.urls` allow a vetted list of 5 to 8 relays; the 2 dead relays above cost nothing because the others answer.
- It is about 0.2 s slower than BitTorrent, which does not matter for a join that happens once per session.
- The planned use passes `relayConfig.urls` with the three working relays above plus one owner-run relay, and `password` from the share link.

## Two-machine run
Each machine installs the probe once, in an empty directory outside the repo:
```
npm i @trystero-p2p/nostr @trystero-p2p/torrent @trystero-p2p/mqtt playwright-core esbuild
npx playwright-core install chromium-headless-shell
```
Pick one room id and one start time (epoch ms, 2 minutes ahead); both sides run the same command except `--role`. Attempt `i` starts at `start + (i-1) * slot`, so the clocks must agree to about a second. Run once per strategy (`nostr`, `torrent`, `mqtt`), add `--ice '[{"urls":"turn:host:3478","username":"u","credential":"p"}]'` to test TURN, and `--chrome <path>` if the browser download is blocked.
```
START=$(( ($(date +%s) + 120) * 1000 ))            # on one machine; copy the number to the other
node signalling-probe.mjs --strategy nostr --role host  --room campus-1 --count 30 --start $START
node signalling-probe.mjs --strategy nostr --role guest --room campus-1 --count 30 --start $START
```
Output is one JSON line per join and a final `summary` line (successes, median and p90 in ms, errors, per-relay open counts). Same-machine check: `--role both` (add `--intruder 1 --password correct --grace 4000` for the password check).

## Campus network results
