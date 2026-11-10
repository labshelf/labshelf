// Declares the few Cloudflare Workers and Durable Object APIs the relay and share Workers use, so core needs no Workers type package.

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

/** The inbox needs no sockets, only its SQLite storage. */
export interface InboxState {
  storage: { sql: SqlStorage };
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

/** One stored R2 object, read whole or as a stream. */
interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  body: ReadableStream<Uint8Array>;
}

/** The part of an R2 bucket binding the Mirror uses; `delete` takes up to 1000 keys, `list` pages by `cursor`. */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}

/** The bindings and secret the deploy sets on the share Worker; `MIRROR_BUCKET` only once the owner moved the Mirror to R2. */
export interface ShareEnv {
  KV: KvNamespace;
  OWNER_SECRET?: string;
  MIRROR: CloudflareNamespaceLike;
  MIRROR_BUCKET?: R2BucketLike;
}

/** The bindings and secrets the deploy sets on the relay Worker; its `MIRROR` names the share Worker's class. */
export interface RelayEnv extends ShareEnv {
  ROOM: CloudflareNamespaceLike;
  INBOX: CloudflareNamespaceLike;
}

/** The Mirror's storage: SQLite and `transactionSync`, which rolls every write of `work` back when it throws. */
export interface MirrorState {
  storage: { sql: SqlStorage; transactionSync<T>(work: () => T): T };
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
