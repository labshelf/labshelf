// Connects to a share's relay over WebSocket: its peers as transport peers, store requests for the relay sync, and reconnects.
import type { ILogger } from "../../../ports/index.js";
import {
  decodeServerMessage, encodeRelayMessage, MAX_RELAY_MESSAGE_BYTES, type RelayClientMessage, type RelayServerMessage,
} from "../../../relay/index.js";
import { CHANNEL_KIND, systemScheduler, type SessionScheduler } from "../../sync/index.js";
import type { PeerId, PeerTransport } from "../peerTransport.js";
import { LatestWinsThrottle } from "./latestWinsThrottle.js";
import { RelayRequestError } from "./relayRequestError.js";
import { fetchTicket } from "./relayRequests.js";
import { globalSocketFactory, messageBytes, relaySocketUrl, type RelaySocket, type RelaySocketFactory } from "./relaySocket.js";

const LOG_MODULE = "collab.relay";
const PEER_PREFIX = "relay:";
/** Cursor moves reach relay peers at most this often; each forward is a billed socket message. */
export const RELAY_AWARENESS_INTERVAL_MS = 1000;
export const RECONNECT_FIRST_MS = 1000;
export const RECONNECT_MAX_MS = 60_000;
/** A forward adds its type, `to` and frame length to the share message. */
const FORWARD_OVERHEAD_BYTES = 11;

export type RelayStoreRequest = Extract<RelayClientMessage, { type: "put" | "since" | "snapshot" }>;
export type RelayStoreAnswer = Extract<RelayServerMessage, { type: "accepted" | "stored" | "rows" | "error" }>;

/** The store side of a relay connection, which the relay sync drives. */
export interface RelayStore {
  readonly connected: boolean;
  /** Sends a store request; false when the socket is not open, so the caller keeps what it meant to send. */
  request(message: RelayStoreRequest): boolean;
  onStore(listener: (answer: RelayStoreAnswer) => void): () => void;
  /** Called with true when a socket opens and false when it drops. */
  onConnection(listener: (open: boolean) => void): () => void;
}

export interface RelayTransport extends PeerTransport, RelayStore {
  receivesUpdatesFromStore(peer: PeerId): boolean;
}

export interface RelayTransportOptions {
  relayUrl: string;
  shareId: string;
  relayToken: string;
  logger: ILogger;
  socketFactory?: RelaySocketFactory;
  fetch?: typeof fetch;
  scheduler?: SessionScheduler;
}

class Listeners<A extends unknown[]> {
  private set = new Set<(...args: A) => void>();
  add(fn: (...args: A) => void): () => void { this.set.add(fn); return () => { this.set.delete(fn); }; }
  emit(...args: A): void { this.set.forEach((fn) => fn(...args)); }
}

// CONTRACT: documents/contracts/relay.md#clients
export function createRelayTransport(options: RelayTransportOptions): RelayTransport {
  return new RelayConnection(options);
}

class RelayConnection implements RelayTransport {
  private readonly message = new Listeners<[PeerId, Uint8Array]>();
  private readonly join = new Listeners<[PeerId]>();
  private readonly leave = new Listeners<[PeerId]>();
  private readonly store = new Listeners<[RelayStoreAnswer]>();
  private readonly connection = new Listeners<[boolean]>();
  private readonly ids = new Set<number>();
  private readonly scheduler: SessionScheduler;
  private readonly awareness: LatestWinsThrottle<number>;
  private socket: RelaySocket | undefined;
  private open = false;
  private closed = false;
  private attempt = 0;
  private cancelRetry: (() => void) | undefined;

  constructor(private options: RelayTransportOptions) {
    this.scheduler = options.scheduler ?? systemScheduler;
    this.awareness = new LatestWinsThrottle(RELAY_AWARENESS_INTERVAL_MS, this.scheduler, (to, frame) => this.write({ type: "forward", to, frame }));
    void this.connect();
  }

  get peers(): PeerId[] { return [...this.ids].map((id) => PEER_PREFIX + id); }

  get connected(): boolean { return this.open; }

  send(to: PeerId | "all", bytes: Uint8Array): void {
    const id = to === "all" ? 0 : Number(to.slice(PEER_PREFIX.length));
    if (to !== "all" && (!to.startsWith(PEER_PREFIX) || !this.ids.has(id))) { return; }
    if (bytes.length + FORWARD_OVERHEAD_BYTES > MAX_RELAY_MESSAGE_BYTES) {
      void this.options.logger.log("WARN", LOG_MODULE, "Dropped a message too large for the relay", { shareId: this.options.shareId, bytes: bytes.length });
      return;
    }
    // INVARIANT: an awareness message carries the sender's whole presence, so only the latest one matters.
    if (bytes[1] === CHANNEL_KIND.awareness) { return this.awareness.push(id, bytes); }
    this.write({ type: "forward", to: id, frame: bytes });
  }

  request(outgoing: RelayStoreRequest): boolean { return this.write(outgoing); }
  onMessage(fn: (from: PeerId, bytes: Uint8Array) => void): () => void { return this.message.add(fn); }
  onPeerJoin(fn: (peer: PeerId) => void): () => void { return this.join.add(fn); }
  onPeerLeave(fn: (peer: PeerId) => void): () => void { return this.leave.add(fn); }
  onStore(fn: (answer: RelayStoreAnswer) => void): () => void { return this.store.add(fn); }
  onConnection(fn: (open: boolean) => void): () => void { return this.connection.add(fn); }
  receivesUpdatesFromStore(peer: PeerId): boolean { return peer.startsWith(PEER_PREFIX); }

  async close(): Promise<void> {
    this.closed = true;
    this.cancelRetry?.();
    const current = this.socket;
    this.dropped("closed by this device");
    current?.close();
  }

  private write(outgoing: RelayClientMessage): boolean {
    if (!this.open || !this.socket) { return false; }
    this.socket.send(encodeRelayMessage(outgoing));
    return true;
  }

  private async connect(): Promise<void> {
    const { relayUrl, shareId, relayToken } = this.options;
    let ticket: string;
    try {
      ticket = (await fetchTicket({ relayUrl, shareId, relayToken, ...(this.options.fetch ? { fetch: this.options.fetch } : {}) })).ticket;
    } catch (error) {
      if (error instanceof RelayRequestError && error.code === "incompatibleRelay") { return this.stop(error); }
      return this.dropped(`ticket: ${String(error)}`);
    }
    if (this.closed) { return; }
    const socket = (this.options.socketFactory ?? globalSocketFactory)(relaySocketUrl(relayUrl, shareId, ticket));
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      this.attempt = 0;
      this.open = true;
      void this.options.logger.log("INFO", LOG_MODULE, "Relay socket open", { shareId });
      this.connection.emit(true);
    };
    socket.onmessage = (event) => {
      const bytes = messageBytes(event.data);
      if (bytes && this.socket === socket) { this.receive(bytes); }
    };
    socket.onclose = (event) => { if (this.socket === socket) { this.dropped(`closed ${event.code} ${event.reason}`); } };
    // The close event that follows an error carries the reason and drives the reconnect.
    socket.onerror = () => {};
  }

  private receive(bytes: Uint8Array): void {
    const decoded = decodeServerMessage(bytes);
    if (!decoded.ok) {
      if (decoded.error === "incompatibleVersion") {
        return this.stop(new RelayRequestError("incompatibleRelay", 0, `the relay speaks major ${decoded.major}`));
      }
      if (decoded.error !== "unknownType") {
        void this.options.logger.log("WARN", LOG_MODULE, "Ignored an unreadable relay message", { shareId: this.options.shareId, error: decoded.error });
      }
      return;
    }
    const incoming = decoded.message;
    switch (incoming.type) {
      case "peers": incoming.ids.forEach((id) => this.addPeer(id)); return;
      case "joined": this.addPeer(incoming.id); return;
      case "left": this.removePeer(incoming.id); return;
      case "forwarded": this.message.emit(PEER_PREFIX + incoming.from, incoming.frame); return;
      case "error":
        if (incoming.doc) { this.store.emit(incoming); return; }
        void this.options.logger.log("WARN", LOG_MODULE, "The relay refused a message", { shareId: this.options.shareId, code: incoming.code });
        return;
      default: this.store.emit(incoming);
    }
  }

  private addPeer(id: number): void {
    if (!this.ids.has(id)) { this.ids.add(id); this.join.emit(PEER_PREFIX + id); }
  }

  private removePeer(id: number): void {
    if (this.ids.delete(id)) { this.leave.emit(PEER_PREFIX + id); }
  }

  private dropped(reason: string): void {
    this.socket = undefined;
    this.awareness.clear();
    [...this.ids].forEach((id) => this.removePeer(id));
    if (this.open) { this.open = false; this.connection.emit(false); }
    if (this.closed) { return; }
    const delay = Math.min(RECONNECT_FIRST_MS * 2 ** this.attempt, RECONNECT_MAX_MS);
    this.attempt += 1;
    void this.options.logger.log("WARN", LOG_MODULE, "Relay socket is down; reconnecting", { shareId: this.options.shareId, reason, attempt: this.attempt, delayMs: delay });
    this.cancelRetry = this.scheduler.after(delay, () => { this.cancelRetry = undefined; void this.connect(); });
  }

  /** A relay of another major cannot be talked to until LabShelf or the relay is updated, so retrying is pointless. */
  private stop(error: RelayRequestError): void {
    this.closed = true;
    void this.options.logger.error(LOG_MODULE, error, { shareId: this.options.shareId });
    const current = this.socket;
    this.dropped(error.message);
    current?.close();
  }
}
