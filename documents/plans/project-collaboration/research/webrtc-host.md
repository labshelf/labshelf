files: none kept (scratch VS Code extension, node-datachannel peer and runner; probe only; no product code)
source: measured 2026-10-17 with VS Code 1.142.0 (Electron 43.7.7, Node 24.21.0) darwin-arm64 via @vscode/test-electron, node-datachannel 0.33.4, one macOS machine, loopback peer, 5 MB transfers, median of 3

# WebRTC host

## Decision

`RTCPeerConnection` runs in the extension host through `node-datachannel` (option b), not in a webview (option a).

- The session belongs to the extension, not to a UI surface. A webview exists only after the user opens it. A plain view drops the channel as soon as it is hidden, and disposing a panel kills it.
- A retained webview survives every hide case. Even so, each message pays an extra postMessage hop, and the host-relayed path gets about half the throughput of the host channel.
- node-datachannel loads inside Electron's Node and costs a few milliseconds at startup.
- The costs: one VSIX per platform target, a native binary of about 3.6 MB in each, and no trystero in VS Code. trystero 0.26.0 cannot use `node-datachannel/polyfill` as `rtcPolyfill` because the handshake never completes, so the VS Code side drives node-datachannel with its own signalling. If the plan has to keep trystero in VS Code, the fallback is option a with a retained WebviewView.

## Measurements

| Case | Alive while hidden (peer pings answered) |
|---|---|
| WebviewView, `retainContextWhenHidden`, sidebar closed | yes, 30/30 in 15 s, 5 MB sent while hidden at 37 MB/s |
| same, switched to Explorer | yes, 30/30, 35 MB/s |
| same, `removeView` | yes, 30/30, 32.5 MB/s |
| WebviewView without retain, sidebar closed | no, 0/0, channel closed, postMessage returns false |
| WebviewPanel (retained) in a background tab | yes, 30/30, 33.6 MB/s |
| WebviewPanel disposed | no, channel closed |
| node-datachannel in the extension host | yes, independent of UI |

| Path (5 MB) | MB/s |
|---|---|
| extension host → peer (node-datachannel, 64 KB chunks) | 59.5 |
| postMessage host → webview, one way (half of the echo round trip) | 370–526 |
| host → webview → peer (retained view / panel) | 29.9–35.2 |
| webview-generated → peer (view / panel) | 43.5 / 52.1 visible, 37.3 hidden |

| VSIX target | `@node-datachannel/<pkg>` tgz / unpacked | VSIX |
|---|---|---|
| darwin-arm64 | 3.6 MB / 8.7 MB | 3.58 MB measured (187 files, 9.4 MB unpacked) |
| darwin-x64 | 3.2 MB / 8.9 MB | about 3.4 MB |
| linux-x64 (`linux-x64-gnu`) | 3.5 MB / 9.1 MB | about 3.7 MB |
| win32-x64 (`win32-x64-msvc`) | 3.1 MB / 7.5 MB | about 3.3 MB |

The `node-datachannel` JS package adds 0.68 MB unpacked. The non-darwin-arm64 VSIX sizes are the binary tarball plus the measured remainder.

Startup: `require('node-datachannel')` in the extension host takes 9 ms, activation (two views and a panel registered) 29 ms, and a host PeerConnection opens its channel in 22 ms on loopback. A webview takes 195 ms (view) or 120 ms (panel) from resolve to ready, then 282 ms or 142 ms to connect.

`vsce package --target <platform>` builds one VSIX for each target, and each one contains only that target's `@node-datachannel/<platform>` binary. So installing dependencies per target means one `npm install` per OS (or a fetch of the matching package), followed by one `vsce publish --target` (or `--packagePath`) upload per VSIX to the Marketplace. Open VSX takes the same targets. With no matching target the Marketplace serves no VSIX, so every supported platform needs its own build. The VSIX needs `node-datachannel`'s runtime dependency `detect-libc`. Without it, `npm list --production` fails the packaging.

## Traps found

- TRAP: a `DataChannel` whose JS wrapper is unreferenced gets collected, and its destructor closes the native channel. The answerer then sees "SCTP connected" but `onDataChannel` never fires. Keep a reference to every `PeerConnection` and `DataChannel`.
- TRAP: gathering can complete before an `onGatheringStateChange` handler attached after `createDataChannel` runs, and then the handler never fires. Attach handlers first, or poll `gatheringState()`, or send SDP and candidates from `onLocalDescription` / `onLocalCandidate`.

## Not measured

- Windows and Linux: loading and VSIX installs. Their sizes come from the npm tarballs, not from real VSIX builds.
- Remote, WSL and Codespaces extension hosts (the binary must match the remote OS), and VS Code for the Web, where there is no Node host and only option a is possible.
- NAT traversal, TURN, and links other than loopback. Memory and CPU use while idle.
- Marketplace upload and signing. Packaging used `--allow-missing-repository --skip-license`.

## trystero in Node

trystero 0.26.0 (`@trystero-p2p/nostr`) works in plain Node with node-datachannel 0.33.4 only through a wrapper; the plain polyfill never sends an offer, with or without `--expose-gc`, so GC is not the cause. The polyfill's `createDataChannel` auto-negotiates into `have-local-offer` and fires `negotiationneeded` before trystero's handler exists; trystero's microtask retry then skips because `localDescription` is never `null` and the state is not `stable`; and `setLocalDescription()` without a type does nothing. The wrapper turns auto-negotiation off and fixes those three:

```js
import ndc from 'node-datachannel'
import {RTCPeerConnection as Polyfill} from 'node-datachannel/polyfill'
export class NodeRTCPeerConnection extends Polyfill {
  #native
  constructor(config = {}) {
    const iceServers = (config.iceServers ?? []).flatMap((s) => [s.urls].flat())
    const native = new ndc.PeerConnection('peer', {iceServers, disableAutoNegotiation: true})
    super({...config, peerConnection: native}); this.#native = native
  }
  get localDescription() { return this.#native.localDescription() && super.localDescription }
  get remoteDescription() { return this.#native.remoteDescription() && super.remoteDescription }
  async setLocalDescription(d) { this.#native.setLocalDescription(d?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer')) }
}
```

Measured on Node 26.11 (macOS arm64, loopback, public Nostr relays), two processes: 10 of 10 joins on fresh room ids connect, with and without `--expose-gc`. Time to peer is 1.4–1.6 s on the first join (relay connect included) and about 105 ms after that; a request/response round trip takes 1–11 ms. Cost: trystero core plus nostr is 660 KB of JS; node-datachannel is 1.1 MB of JS plus an 8.3 MB N-API 8 binary per platform (`@node-datachannel/<os>-<arch>`), so it loads in Electron without a rebuild. One trystero module instance has one `selfId`, so two rooms in one process never see each other. The wrapper drops TURN credentials (it passes only `urls`), and Electron's Node 24, `@roamhq/wrtc` and `werift` are not tried.
