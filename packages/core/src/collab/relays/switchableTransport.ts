// Presents whichever relay transport a share uses right now as one stable transport, so a session outlives a relay switch.
import type { PeerId, PeerTransport } from "../transport/index.js";

export interface SwitchableTransport extends PeerTransport {
  /** Replaces the inner transport: the peers of the previous one leave, those of the next one join. It does not close either. */
  use(transport: PeerTransport | undefined): void;
}

const listen = <F>(set: Set<F>, fn: F) => { set.add(fn); return () => { set.delete(fn); }; };

export function createSwitchableTransport(): SwitchableTransport {
  const message = new Set<(from: PeerId, bytes: Uint8Array) => void>();
  const join = new Set<(peer: PeerId) => void>();
  const leave = new Set<(peer: PeerId) => void>();
  const emit = <A extends unknown[]>(set: Set<(...args: A) => void>, ...args: A) => set.forEach((fn) => fn(...args));
  let inner: PeerTransport | undefined;
  let stops: (() => void)[] = [];
  const use = (next: PeerTransport | undefined) => {
    stops.forEach((stop) => stop());
    inner?.peers.forEach((peer) => emit(leave, peer));
    inner = next;
    stops = next ? [
      next.onMessage((from, bytes) => emit(message, from, bytes)),
      next.onPeerJoin((peer) => emit(join, peer)),
      next.onPeerLeave((peer) => emit(leave, peer)),
    ] : [];
    next?.peers.forEach((peer) => emit(join, peer));
  };
  return {
    get peers() { return inner?.peers ?? []; },
    send: (to, bytes) => inner?.send(to, bytes),
    onMessage: (fn) => listen(message, fn),
    onPeerJoin: (fn) => listen(join, fn),
    onPeerLeave: (fn) => listen(leave, fn),
    use,
    close: async () => {
      const current = inner;
      use(undefined);
      await current?.close();
    },
  };
}
