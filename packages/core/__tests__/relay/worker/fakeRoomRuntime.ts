// Runs the relay Worker's Durable Objects on in-memory SQLite with recording sockets, standing in for Cloudflare.
import { DatabaseSync } from "node:sqlite";
import {
  decodeServerMessage, encodeRelayMessage, type RelayClientMessage, type RelayServerMessage,
} from "../../../src/relay/index";
import { fakeKv } from "./fakeKv";
import { Room, type HibernatingConnection, type RelayEnv, type RoomState, type SqlCursor, type SqlField } from "../../../src/relay/worker/index";

export const OWNER_SECRET = "owner-secret-for-tests";

/** Cloudflare's `sql.exec` semantics over node:sqlite: blobs travel as ArrayBuffer, a script without bindings runs whole. */
export function fakeSql(db: DatabaseSync) {
  return {
    exec<Row>(query: string, ...bindings: SqlField[]): SqlCursor<Row> {
      if (bindings.length === 0 && /;\s*\S/.test(query)) { db.exec(query); return cursorOf<Row>([]); }
      const args = bindings.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value));
      const rows = db.prepare(query).all(...(args as (string | number | null | Uint8Array)[])) as Record<string, unknown>[];
      return cursorOf<Row>(rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, value instanceof Uint8Array ? value.slice().buffer : value]))) as Row[]);
    },
  };
}

function cursorOf<Row>(rows: Row[]): SqlCursor<Row> {
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

/** A Worker env whose namespace keeps one FakeRoom per share and records the socket upgrades it receives; `KV` is a map. */
export function fakeEnv(overrides: Partial<RelayEnv> = {}) {
  const rooms = new Map<string, FakeRoom>();
  const upgrades: Request[] = [];
  const roomFor = (name: string) => rooms.get(name) ?? rooms.set(name, new FakeRoom()).get(name)!;
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
    ...overrides,
  };
  return { env, rooms, upgrades };
}
