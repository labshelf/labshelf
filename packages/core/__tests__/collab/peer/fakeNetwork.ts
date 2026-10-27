/** Simulates a peer mesh on virtual time that can partition and rejoin peers. */
import type { PeerId, PeerTransport } from "../../../src/collab/relays/index";
import type { SessionScheduler } from "../../../src/collab/peer/index";

export class FakeClock implements SessionScheduler {
  private time = 0;
  private nextId = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number { return this.time; }

  after(ms: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, fn });
    return () => { this.timers.delete(id); };
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) { break; }
      this.timers.delete(due[0]);
      this.time = Math.max(this.time, due[1].at);
      due[1].fn();
    }
    this.time = target;
  }
}

/** Deterministic PRNG (mulberry32) so a failing run repeats. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Listeners {
  message: Set<(from: PeerId, bytes: Uint8Array) => void>;
  join: Set<(peer: PeerId) => void>;
  leave: Set<(peer: PeerId) => void>;
}

export class FakeNetwork {
  readonly sent: { from: PeerId; to: PeerId }[] = [];
  private transports = new Map<PeerId, Listeners>();
  /** Peer to its connection count; a frame in flight across a reconnect is lost, as on a real link. */
  private online = new Map<PeerId, number>();
  private connections = 0;

  constructor(private clock: FakeClock) {}

  join(id: PeerId): PeerTransport {
    const listeners: Listeners = { message: new Set(), join: new Set(), leave: new Set() };
    this.transports.set(id, listeners);
    const network = this;
    const subscribe = <T>(set: Set<T>, fn: T) => { set.add(fn); return () => { set.delete(fn); }; };
    const transport: PeerTransport = {
      get peers() { return network.peersOf(id); },
      send: (to, bytes) => this.send(id, to, bytes),
      onMessage: (fn) => subscribe(listeners.message, fn),
      onPeerJoin: (fn) => subscribe(listeners.join, fn),
      onPeerLeave: (fn) => subscribe(listeners.leave, fn),
      close: async () => { this.disconnect(id); this.transports.delete(id); },
    };
    this.online.set(id, ++this.connections);
    for (const other of this.peersOf(id)) { this.transports.get(other)!.join.forEach((fn) => fn(id)); }
    return transport;
  }

  /** Cuts a peer off; its transport stays and reports the others as left. */
  disconnect(id: PeerId): void {
    if (!this.online.delete(id)) { return; }
    for (const other of this.online.keys()) {
      this.transports.get(other)!.leave.forEach((fn) => fn(id));
      this.transports.get(id)!.leave.forEach((fn) => fn(other));
    }
  }

  reconnect(id: PeerId): void {
    this.online.set(id, ++this.connections);
    for (const other of this.peersOf(id)) {
      this.transports.get(other)!.join.forEach((fn) => fn(id));
      this.transports.get(id)!.join.forEach((fn) => fn(other));
    }
  }

  private peersOf(id: PeerId): PeerId[] {
    return this.online.has(id) ? [...this.online.keys()].filter((peer) => peer !== id) : [];
  }

  private send(from: PeerId, to: PeerId | "all", bytes: Uint8Array): void {
    const targets = to === "all" ? this.peersOf(from) : this.peersOf(from).filter((peer) => peer === to);
    const fromConnection = this.online.get(from);
    for (const target of targets) {
      const toConnection = this.online.get(target);
      this.sent.push({ from, to: target });
      const copy = bytes.slice();
      this.clock.after(0, () => {
        if (this.online.get(target) === toConnection && this.online.get(from) === fromConnection) {
          this.transports.get(target)!.message.forEach((fn) => fn(from, copy));
        }
      });
    }
  }
}

/** Advances virtual time in steps and yields to real time so WebCrypto work completes, until `done` holds. */
export async function runUntil(clock: FakeClock, done: () => boolean, maxVirtualMs = 120_000, stepMs = 50): Promise<boolean> {
  for (let elapsed = 0; elapsed <= maxVirtualMs; elapsed += stepMs) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (done()) { return true; }
    clock.advance(stepMs);
  }
  return done();
}
