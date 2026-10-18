// Declares the few Cloudflare Workers and Durable Object APIs the relay Worker uses, so core needs no Workers type package.

export type SqlValue = ArrayBuffer | string | number | null;

export interface SqlCursor<Row> extends Iterable<Row> {
  toArray(): Row[];
}

/** `ctx.storage.sql`: synchronous; writes in one event commit together. */
export interface SqlStorage {
  exec<Row = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): SqlCursor<Row>;
}

/** A server socket accepted with the Hibernation API; the attachment survives hibernation. */
export interface HibernatingSocket {
  send(data: Uint8Array): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface RoomState {
  storage: { sql: SqlStorage };
  acceptWebSocket(socket: HibernatingSocket): void;
  getWebSockets(): HibernatingSocket[];
}

export interface RoomStub {
  fetch(request: Request): Promise<Response>;
}

export interface RoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): RoomStub;
}

/** The bindings and secrets the deploy sets; the TURN key is optional. */
export interface RelayEnv {
  ROOM: RoomNamespace;
  OWNER_SECRET?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_SECRET?: string;
}

// PLATFORM: WebSocketPair and a 101 Response carrying `webSocket` exist only on Workers, so they are reached untyped.
export function openSocketPair(): { client: unknown; server: HibernatingSocket } {
  const Pair = (globalThis as unknown as { WebSocketPair: new () => Record<0 | 1, HibernatingSocket> }).WebSocketPair;
  const pair = new Pair();
  return { client: pair[0], server: pair[1] };
}

export function upgradeResponse(client: unknown): Response {
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}
