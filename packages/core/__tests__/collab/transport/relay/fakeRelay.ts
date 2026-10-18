/** Plays a share's relay Durable Object in process on virtual time, counting the requests the free plan bills. */
import {
  decodeClientMessage, encodeRelayBody, encodeRelayMessage, type RelayRow, type RelayServerMessage,
} from "../../../../src/relay/index";
import type { RelaySocket } from "../../../../src/collab/transport/index";
import type { FakeClock } from "../../sync/fakeNetwork";

const LATENCY_MS = 5;
/** Incoming socket messages are billed at 20 to 1. */
const SOCKET_MESSAGES_PER_REQUEST = 20;
const PAGE_ROWS = 50;

class FakeSocket implements RelaySocket {
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  id = 0;
  live = false;

  constructor(private relay: FakeRelay, readonly url: string) {}

  send(data: Uint8Array): void {
    if (!this.live) { throw new Error("send on a closed socket"); }
    const copy = data.slice();
    this.relay.clock.after(LATENCY_MS, () => { if (this.live) { this.relay.receive(this, copy); } });
  }

  close(): void { this.relay.drop(this, 1000, "client closed"); }

  deliver(message: RelayServerMessage): void {
    const bytes = encodeRelayMessage(message);
    this.relay.clock.after(LATENCY_MS, () => { if (this.live) { this.onmessage?.({ data: bytes.buffer }); } });
  }
}

export class FakeRelay {
  readonly counts = { http: 0, opens: 0, put: 0, since: 0, snapshot: 0, forward: 0 };
  /** Put times per connection and doc. */
  /** Forwarded share messages by envelope kind. */
  readonly forwardKinds = new Map<number, number>();
  readonly putTimes = new Map<string, number[]>();
  readonly rows = new Map<string, RelayRow[]>();
  readonly snapshots = new Map<string, { covers: number; frame: Uint8Array }>();
  private sockets = new Map<number, FakeSocket>();
  private lastByDoc = new Map<string, number>();
  private lastCursor = 0;
  private nextId = 1;
  /** While false, tickets are refused as if the relay were down. */
  up = true;

  constructor(readonly clock: FakeClock) {}

  get billed(): number {
    const socketMessages = this.counts.put + this.counts.since + this.counts.snapshot + this.counts.forward;
    return this.counts.http + this.counts.opens + socketMessages / SOCKET_MESSAGES_PER_REQUEST;
  }

  fetch: typeof fetch = async (input, init) => {
    this.counts.http += 1;
    const url = String(input);
    if (!this.up) { throw new TypeError("fetch failed"); }
    if (!url.endsWith("/ticket") || init?.method !== "POST") { return new Response("{}", { status: 404 }); }
    return new Response(encodeRelayBody({ ticket: "1.ticket", expires: 2_000_000_000 }), { status: 200 });
  };

  socketFactory = (url: string): RelaySocket => {
    const socket = new FakeSocket(this, url);
    this.clock.after(LATENCY_MS, () => this.open(socket));
    return socket;
  };

  /** Drops every socket, as a Worker update does. */
  dropAll(): void { [...this.sockets.values()].forEach((socket) => this.drop(socket, 1012, "service restart")); }

  drop(socket: FakeSocket, code: number, reason: string): void {
    if (!socket.live) { return; }
    socket.live = false;
    this.sockets.delete(socket.id);
    this.sockets.forEach((other) => other.deliver({ type: "left", id: socket.id }));
    this.clock.after(LATENCY_MS, () => socket.onclose?.({ code, reason }));
  }

  private open(socket: FakeSocket): void {
    this.counts.opens += 1;
    socket.id = this.nextId++;
    socket.live = true;
    socket.deliver({ type: "peers", ids: [...this.sockets.keys()] });
    this.sockets.forEach((other) => other.deliver({ type: "joined", id: socket.id }));
    this.sockets.set(socket.id, socket);
    socket.onopen?.();
  }

  receive(from: FakeSocket, bytes: Uint8Array): void {
    const decoded = decodeClientMessage(bytes);
    if (!decoded.ok) { throw new Error(`client sent a bad message: ${decoded.error}`); }
    const message = decoded.message;
    this.counts[message.type] += 1;
    switch (message.type) {
      case "put": {
        const key = `${from.id}:${message.doc}`;
        this.putTimes.set(key, [...(this.putTimes.get(key) ?? []), this.clock.now()]);
        const cursor = ++this.lastCursor;
        this.lastByDoc.set(message.doc, cursor);
        this.rows.set(message.doc, [...(this.rows.get(message.doc) ?? []), { cursor, frame: message.frame }]);
        from.deliver({ type: "accepted", doc: message.doc, cursor });
        this.others(from).forEach((other) => other.deliver({ type: "stored", from: from.id, doc: message.doc, cursor, frame: message.frame }));
        return;
      }
      case "since": return this.since(from, message.doc, message.cursor);
      case "snapshot": {
        const rows = this.rows.get(message.doc) ?? [];
        const stored = this.snapshots.get(message.doc);
        if ((stored && message.covers <= stored.covers) || message.covers > (this.lastByDoc.get(message.doc) ?? 0)) {
          return from.deliver({ type: "error", code: 4, doc: message.doc });
        }
        this.snapshots.set(message.doc, { covers: message.covers, frame: message.frame });
        this.rows.set(message.doc, rows.filter((row) => row.cursor > message.covers));
        return from.deliver({ type: "accepted", doc: message.doc, cursor: message.covers });
      }
      case "forward": {
        this.forwardKinds.set(message.frame[1]!, (this.forwardKinds.get(message.frame[1]!) ?? 0) + 1);
        const targets = message.to === 0 ? this.others(from) : this.others(from).filter((other) => other.id === message.to);
        targets.forEach((other) => other.deliver({ type: "forwarded", from: from.id, frame: message.frame }));
      }
    }
  }

  private since(from: FakeSocket, doc: string, cursor: number): void {
    const snapshot = this.snapshots.get(doc);
    const withSnapshot = snapshot && snapshot.covers > cursor ? snapshot : undefined;
    const floor = Math.max(cursor, snapshot?.covers ?? 0);
    const above = (this.rows.get(doc) ?? []).filter((row) => row.cursor > floor);
    const items = above.slice(0, PAGE_ROWS);
    from.deliver({ type: "rows", doc, more: above.length > PAGE_ROWS, ...(withSnapshot ? { snapshot: withSnapshot } : {}), items });
  }

  private others(socket: FakeSocket): FakeSocket[] {
    return [...this.sockets.values()].filter((other) => other !== socket);
  }
}

/** Advances virtual time in steps, yielding to the event loop so WebCrypto work completes between them. */
export async function runFor(clock: FakeClock, ms: number, stepMs = 100): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += stepMs) {
    await settle();
    clock.advance(stepMs);
  }
  await settle();
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) { await new Promise((resolve) => setImmediate(resolve)); }
}
