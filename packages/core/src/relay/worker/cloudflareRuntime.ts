// Declares the few Cloudflare Workers and Durable Object APIs the relay Worker uses, so core needs no Workers type package.

export type SqlField = ArrayBuffer | string | number | null;

export interface CloudflareCursorLike<Row> extends Iterable<Row> {
  toArray(): Row[];
}

/** `ctx.storage.sql`: synchronous; writes in one event commit together. */
export interface SqlStorage {
  exec<Row = Record<string, SqlField>>(query: string, ...bindings: SqlField[]): CloudflareCursorLike<Row>;
}

/** A server socket accepted with the Hibernation API; the attachment survives hibernation. */
export interface HibernatingConnection {
  send(data: Uint8Array): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface RoomState {
  storage: { sql: SqlStorage };
  acceptWebSocket(socket: HibernatingConnection): void;
  getWebSockets(): HibernatingConnection[];
}

export interface CloudflareStubLike {
  fetch(request: Request): Promise<Response>;
}

interface CloudflareNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): CloudflareStubLike;
}

/** The part of a Workers KV namespace the share endpoints use; values are read as streams so a check never buffers a blob. */
export interface KvNamespace {
  get(key: string, type: "stream"): Promise<ReadableStream<Uint8Array> | null>;
  put(key: string, value: ArrayBuffer): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The bindings and secrets the deploy sets. */
export interface RelayEnv {
  ROOM: CloudflareNamespaceLike;
  KV: KvNamespace;
  OWNER_SECRET?: string;
}

// PLATFORM: WebSocketPair and a 101 Response carrying `webSocket` exist only on Workers, so they are reached untyped.
export function openConnectionPair(): { client: unknown; server: HibernatingConnection } {
  const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, HibernatingConnection> }).WebSocketPair;
  const pair = new Pair();
  return { client: pair[0], server: pair[1] };
}

export function createUpgradeResponse(client: unknown): Response {
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}
