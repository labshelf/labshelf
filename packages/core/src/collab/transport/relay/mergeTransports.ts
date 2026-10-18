// Joins several transports into one, so a share session reaches its direct peers and its relay peers at the same time.
import type { PeerId, PeerTransport } from "../peerTransport.js";

// CONTRACT: documents/contracts/relay.md#clients
/** Peer ids must not collide across the transports; a relay transport prefixes its own. */
export function mergeTransports(...transports: PeerTransport[]): PeerTransport {
  const ownerOf = (peer: PeerId) => transports.find((transport) => transport.peers.includes(peer));
  const subscribeAll = <L>(subscribe: (transport: PeerTransport, listener: L) => () => void, listener: L) => {
    const stops = transports.map((transport) => subscribe(transport, listener));
    return () => stops.forEach((stop) => stop());
  };
  return {
    get peers() { return transports.flatMap((transport) => transport.peers); },
    send: (to, bytes) => {
      if (to === "all") { transports.forEach((transport) => transport.send("all", bytes)); return; }
      ownerOf(to)?.send(to, bytes);
    },
    onMessage: (listener) => subscribeAll((transport, fn) => transport.onMessage(fn), listener),
    onPeerJoin: (listener) => subscribeAll((transport, fn) => transport.onPeerJoin(fn), listener),
    onPeerLeave: (listener) => subscribeAll((transport, fn) => transport.onPeerLeave(fn), listener),
    close: async () => { await Promise.all(transports.map((transport) => transport.close())); },
    receivesUpdatesFromStore: (peer) => ownerOf(peer)?.receivesUpdatesFromStore?.(peer) ?? false,
  };
}
