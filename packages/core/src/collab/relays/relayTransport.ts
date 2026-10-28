// Moves a share's frames between peers and a relay: the transport port, the relay WebSocket transport with its ticket and claim requests, and a switchable transport.
import { base64UrlToBytes } from "../../encoding/index.js";
import { deriveSha256Hex } from "../../hash/index.js";
import type { ILogger } from "../../ports/index.js";
import {
  decodeClaimResponse, decodeRefusal, decodeServerMessage, decodeTicketResponse, encodeRelayBody, encodeRelayMessage,
  MAX_RELAY_MESSAGE_BYTES, RELAY_PATH,
  type RelayClientMessage, type RelayServerMessage, type ResponseResult, type TicketResponse,
} from "../../relay/index.js";
import { CHANNEL_KIND, systemScheduler, type PeerId, type PeerTransport, type SessionScheduler } from "../channel.js";

/** The part of the WebSocket API the relay transport uses. */
export interface RelayConnectionPort {
  binaryType: string;
  send(data: Uint8Array): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type RelayConnectionPortFactory = (url: string) => RelayConnectionPort;

// PLATFORM: browsers and Node 22 and later have a global WebSocket; its handler types are narrower than RelayConnectionPort's.
export const createGlobalRelayConnection: RelayConnectionPortFactory = (url) => new WebSocket(url) as unknown as RelayConnectionPort;

/** The socket URL of a share on a relay: its `https:` origin as `wss:`, then the project path and the ticket. */
function deriveRelayConnectionUrl(relayUrl: string, shareId: string, ticket: string): string {
  const base = relayUrl.replace(/\/+$/, "").replace(/^http/, "ws");
  return `${base}/project/${shareId}?ticket=${encodeURIComponent(ticket)}`;
}

/** The bytes of a binary message; undefined for a text message, which the protocol never sends. */
function extractMessageBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) { return data; }
  if (data instanceof ArrayBuffer) { return new Uint8Array(data); }
  return undefined;
}

/** `incompatibleRelay` means a Worker of another major, `relayDown` a 5xx or non-JSON answer, `network` a request that got no answer; any other code is a relay refusal. */
export class RelayRequestError extends Error {
  constructor(readonly code: string, readonly status: number, detail: string) {
    super(`Relay request failed (${code}): ${detail}`);
    this.name = "RelayRequestError";
  }
}

export interface ClaimRequestOptions { relayUrl: string; ownerSecret: string; shareId: string; relayToken: string; fetch?: typeof fetch }
export interface TicketRequestOptions { relayUrl: string; shareId: string; relayToken: string; fetch?: typeof fetch }

// CONTRACT: documents/contracts/relay.md#auth
/** Registers the share on the owner's relay; claiming it again with the same token is a no-op. */
export async function addRelayShare({ relayUrl, ownerSecret, shareId, relayToken, fetch: doFetch = fetch }: ClaimRequestOptions): Promise<void> {
  const relayTokenHash = await deriveSha256Hex(base64UrlToBytes(relayToken));
  await post(doFetch, relayUrl, RELAY_PATH.claim, encodeRelayBody({ shareId, relayTokenHash }), decodeClaimResponse, { authorization: `Bearer ${ownerSecret}` });
}

// CONTRACT: documents/contracts/relay.md#endpoints
export function fetchTicket({ relayUrl, shareId, relayToken, fetch: doFetch = fetch }: TicketRequestOptions): Promise<TicketResponse> {
  return post(doFetch, relayUrl, RELAY_PATH.ticket, encodeRelayBody({ shareId, relayToken }), decodeTicketResponse);
}

async function post<T>(
  doFetch: typeof fetch, relayUrl: string, path: string, body: string, decode: (value: unknown) => ResponseResult<T>, headers: Record<string, string> = {},
): Promise<T> {
  const url = `${relayUrl.replace(/\/+$/, "")}${path}`;
  let response: Response;
  try {
    response = await doFetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  } catch (error) {
    throw new RelayRequestError("network", 0, `${path}: ${String(error)}`);
  }
  // TRAP: a down relay answers with a Cloudflare or proxy HTML page, so a 5xx or a body that is not JSON says the relay is down, not that the network failed.
  if (response.status >= 500) { throw new RelayRequestError("relayDown", response.status, `${path}: HTTP ${response.status}`); }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new RelayRequestError("relayDown", response.status, `${path}: HTTP ${response.status} with a body that is not JSON`);
  }
  const decoded = response.ok ? decode(json) : decodeRefusal(json);
  if (!decoded.ok) {
    const detail = decoded.error === "incompatibleRelay" ? `${path}: the relay speaks ${decoded.worker}` : `${path}: unreadable answer`;
    throw new RelayRequestError(decoded.error, response.status, detail);
  }
  if (!response.ok) { throw new RelayRequestError((decoded.value as { error: string }).error, response.status, `${path} refused`); }
  return decoded.value as T;
}

class Throttle<K> {
  private lastAt = new Map<K, number>();
  private waiting = new Map<K, { bytes: Uint8Array; cancel: () => void }>();

  constructor(private intervalMs: number, private scheduler: SessionScheduler, private emit: (key: K, bytes: Uint8Array) => void) {}

  push(key: K, bytes: Uint8Array): void {
    const held = this.waiting.get(key);
    if (held) { held.bytes = bytes; return; }
    const last = this.lastAt.get(key);
    const now = this.scheduler.now();
    if (last === undefined || now - last >= this.intervalMs) { return this.send(key, bytes); }
    const entry = { bytes, cancel: () => {} };
    entry.cancel = this.scheduler.after(last + this.intervalMs - now, () => {
      this.waiting.delete(key);
      this.send(key, entry.bytes);
    });
    this.waiting.set(key, entry);
  }

  clear(): void {
    this.waiting.forEach((entry) => entry.cancel());
    this.waiting.clear();
    this.lastAt.clear();
  }

  private send(key: K, bytes: Uint8Array): void {
    this.lastAt.set(key, this.scheduler.now());
    this.emit(key, bytes);
  }
}

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

const LOG_MODULE = "collab.relay";
const PEER_PREFIX = "relay:";
/** Cursor moves reach relay peers at most this often; each forward is a billed socket message. */
export const RELAY_AWARENESS_INTERVAL_MS = 250;
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

export type RelayTransport = PeerTransport & RelayStore;

export interface RelayTransportOptions {
  relayUrl: string;
  shareId: string;
  relayToken: string;
  logger: ILogger;
  socketFactory?: RelayConnectionPortFactory;
  fetch?: typeof fetch;
  scheduler?: SessionScheduler;
}

class Listeners<A extends unknown[]> {
  private set = new Set<(...args: A) => void>();
  add(fn: (...args: A) => void): () => void { this.set.add(fn); return () => { this.set.delete(fn); }; }
  emit(...args: A): void { this.set.forEach((fn) => fn(...args)); }
}

// CONTRACT: documents/contracts/relay.md#client-obligations
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
  private readonly awareness: Throttle<number>;
  private socket: RelayConnectionPort | undefined;
  private open = false;
  private closed = false;
  private attempt = 0;
  private cancelRetry: (() => void) | undefined;

  constructor(private options: RelayTransportOptions) {
    this.scheduler = options.scheduler ?? systemScheduler;
    this.awareness = new Throttle(RELAY_AWARENESS_INTERVAL_MS, this.scheduler, (to, frame) => this.write({ type: "forward", to, frame }));
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
    const socket = (this.options.socketFactory ?? createGlobalRelayConnection)(deriveRelayConnectionUrl(relayUrl, shareId, ticket));
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      this.attempt = 0;
      this.open = true;
      void this.options.logger.log("INFO", LOG_MODULE, "Relay socket open", { shareId });
      this.connection.emit(true);
    };
    socket.onmessage = (event) => {
      const bytes = extractMessageBytes(event.data);
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
