// Fake relay for collaboration tests: peers on one loopback exchange frames as a relay would, with an empty store.
import type { PeerId, PeerTransport, RelayTransport } from "@labshelf/core";

/** Delivers frames between the peers that joined, each on a later task, as a relay would. */
export function loopback(): (id: PeerId) => PeerTransport {
  const peers = new Map<PeerId, { message: Set<(from: PeerId, bytes: Uint8Array) => void>; join: Set<(peer: PeerId) => void> }>();
  return (id) => {
    const own = { message: new Set<(from: PeerId, bytes: Uint8Array) => void>(), join: new Set<(peer: PeerId) => void>() };
    const others = (): PeerId[] => [...peers.keys()].filter((peer) => peer !== id);
    const subscribe = <T>(set: Set<T>, fn: T) => { set.add(fn); return () => { set.delete(fn); }; };
    peers.set(id, own);
    setTimeout(() => { for (const other of others()) { peers.get(other)!.join.forEach((fn) => fn(id)); own.join.forEach((fn) => fn(other)); } }, 0);
    return {
      get peers() { return others(); },
      send: (to, bytes) => {
        for (const target of to === "all" ? others() : [to]) { const copy = bytes.slice(); setTimeout(() => peers.get(target)?.message.forEach((fn) => fn(id, copy)), 0); }
      },
      onMessage: (fn) => subscribe(own.message, fn),
      onPeerJoin: (fn) => subscribe(own.join, fn),
      onPeerLeave: () => () => undefined,
      close: async () => { peers.delete(id); },
    };
  };
}

/** A relay connection whose store holds nothing, so the joiner syncs from the owner peer alone. */
export function fakeRelay(peer: PeerTransport): RelayTransport {
  return Object.assign(peer, {
    connected: true,
    request: () => false,
    onStore: () => () => undefined,
    onConnection: (fn: (open: boolean) => void) => { setTimeout(() => fn(true), 0); return () => undefined; },
  });
}
