// Runs the relay Worker's Durable Objects on in-memory SQLite with recording sockets, standing in for Cloudflare.
import { DatabaseSync } from "node:sqlite";
import {
  decodeServerMessage, encodeRelayMessage, type RelayClientMessage, type RelayServerMessage,
} from "../../../src/relay/index";
import { Inbox, Room, type HibernatingConnection, type RelayEnv, type RoomState, type CloudflareCursorLike, type KvNamespace, type SqlField } from "../../../src/relay/worker/index";
import type { MirrorState, R2BucketLike } from "../../../src/relay/worker/cloudflareRuntime";
import { Mirror } from "../../../src/relay/worker/mirror";

export const KV_VALUE_LIMIT = 25 * 1024 * 1024;

/** Stands in for a Workers KV namespace with a map, keeping the stream reads and the 25 MiB value limit of the real one. */
export function fakeKv(): KvNamespace & { entries: Map<string, Uint8Array> } {
  const entries = new Map<string, Uint8Array>();
  return {
    entries,
    get: async (key) => {
      const value = entries.get(key);
      return value ? new Response(value.slice()).body : null;
    },
    put: async (key, value) => {
      if (value.byteLength > KV_VALUE_LIMIT) { throw new Error("KV PUT failed: 413 Value too large"); }
      entries.set(key, new Uint8Array(value.slice(0)));
    },
    delete: async (key) => { entries.delete(key); },
  };
}

/** Stands in for an R2 bucket with a map; `calls` records each put and list, the Class A operations the Mirror counts. */
export function fakeBucket(): R2BucketLike & { objects: Map<string, Uint8Array>; calls: string[] } {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  return {
    objects, calls,
    get: async (key) => {
      const value = objects.get(key);
      return value ? { arrayBuffer: async () => value.slice().buffer, body: new Response(value.slice()).body! } : null;
    },
    put: async (key, value) => {
      calls.push(`put ${key}`);
      objects.set(key, value instanceof Uint8Array ? value.slice() : new Uint8Array(value.slice(0)));
    },
    delete: async (keys) => { for (const key of typeof keys === "string" ? [keys] : keys) { objects.delete(key); } },
    list: async ({ prefix, cursor, limit = 1000 }) => {
      calls.push(`list ${prefix}`);
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor === undefined ? 0 : Number(cursor);
      const truncated = start + limit < keys.length;
      return { objects: keys.slice(start, start + limit).map((key) => ({ key })), truncated, ...(truncated ? { cursor: String(start + limit) } : {}) };
    },
  };
}

/** A Mirror's state over node:sqlite, with a `transactionSync` that rolls back when its work throws. */
export function fakeMirrorState(db: DatabaseSync): MirrorState {
  return {
    storage: {
      sql: fakeSql(db),
      transactionSync: <T>(work: () => T): T => {
        db.exec("SAVEPOINT work");
        try {
          const result = work();
          db.exec("RELEASE work");
          return result;
        } catch (error) {
          db.exec("ROLLBACK TO work");
          db.exec("RELEASE work");
          throw error;
        }
      },
    },
  };
}

export const OWNER_SECRET = "owner-secret-for-tests";

/** Cloudflare's `sql.exec` semantics over node:sqlite: blobs travel as ArrayBuffer, a script without bindings runs whole. */
export function fakeSql(db: DatabaseSync) {
  return {
    exec<Row>(query: string, ...bindings: SqlField[]): CloudflareCursorLike<Row> {
      if (bindings.length === 0 && /;\s*\S/.test(query)) { db.exec(query); return cursorOf<Row>([]); }
      const args = bindings.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
      const rows = db.prepare(query).all(...(args as (string | number | null | Uint8Array)[])) as Record<string, unknown>[];
      return cursorOf<Row>(rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, value instanceof Uint8Array ? value.slice().buffer : value]))) as Row[]);
    },
  };
}

function cursorOf<Row>(rows: Row[]): CloudflareCursorLike<Row> {
  return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
}

export class FakeSocket implements HibernatingConnection {
  readonly received: RelayServerMessage[] = [];
  private attachment: unknown;

  send(data: Uint8Array): void {
    const decoded = decodeServerMessage(data);
    if (!decoded.ok) { throw new Error(`relay sent an undecodable message: ${decoded.error}`); }
    this.received.push(decoded.message);
  }

  serializeAttachment(value: unknown): void { this.attachment = structuredClone(value); }
  deserializeAttachment(): unknown { return structuredClone(this.attachment); }

  take(): RelayServerMessage[] { return this.received.splice(0); }
}

export class FakeRoom {
  readonly db = new DatabaseSync(":memory:");
  private readonly sockets: FakeSocket[] = [];
  readonly room: Room;

  constructor() {
    const state: RoomState = {
      storage: { sql: fakeSql(this.db) },
      acceptWebSocket: (socket) => { this.sockets.push(socket as FakeSocket); },
      getWebSockets: () => [...this.sockets],
    };
    this.room = new Room(state);
  }

  connect(): FakeSocket {
    const socket = new FakeSocket();
    this.room.admit(socket);
    return socket;
  }

  send(socket: FakeSocket, message: RelayClientMessage): RelayServerMessage[] {
    this.room.webSocketMessage(socket, encodeRelayMessage(message).buffer as ArrayBuffer);
    return socket.take();
  }

  close(socket: FakeSocket): void {
    this.sockets.splice(this.sockets.indexOf(socket), 1);
    this.room.webSocketClose(socket);
  }

  /** Every value of every row of every table, for checking what the relay keeps. */
  dump(): unknown[] {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    return tables.flatMap(({ name }) => (this.db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[])
      .flatMap((row) => Object.values(row)));
  }
}

/**
 * A Worker env whose namespace keeps one FakeRoom per share and records the socket upgrades it receives; `KV` is a map.
 * `INBOX` keeps one Inbox per name on its own SQLite, and `inboxCalls` counts the requests that reached it; `MIRROR` keeps one Mirror per name.
 */
export function fakeEnv(overrides: Partial<RelayEnv> = {}) {
  const rooms = new Map<string, FakeRoom>();
  const upgrades: Request[] = [];
  const roomFor = (name: string) => rooms.get(name) ?? rooms.set(name, new FakeRoom()).get(name)!;
  const inboxes = new Map<string, Inbox>();
  const inboxFor = (name: string) =>
    inboxes.get(name) ?? inboxes.set(name, new Inbox({ storage: { sql: fakeSql(new DatabaseSync(":memory:")) } })).get(name)!;
  const mirrors = new Map<string, Mirror>();
  const mirrorFor = (name: string) =>
    mirrors.get(name) ?? mirrors.set(name, new Mirror(fakeMirrorState(new DatabaseSync(":memory:")), {})).get(name)!;
  let inboxCalls = 0;
  const env: RelayEnv = {
    OWNER_SECRET,
    KV: fakeKv(),
    ROOM: {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (request) => {
          if (request.headers.get("Upgrade")) { upgrades.push(request); return new Response(null, { status: 200 }); }
          return roomFor(id as string).room.fetch(request);
        },
      }),
    },
    INBOX: {
      idFromName: (name) => name,
      get: (id) => ({ fetch: async (request) => { inboxCalls += 1; return inboxFor(id as string).fetch(request); } }),
    },
    MIRROR: {
      idFromName: (name) => name,
      get: (id) => ({ fetch: (request) => mirrorFor(id as string).fetch(request) }),
    },
    ...overrides,
  };
  return { env, rooms, upgrades, inboxCalls: () => inboxCalls };
}
