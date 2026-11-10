// Holds the owner's remote library as a Durable Object: the mirrored rows (chunked over the row limit), the owner email, the writer lease and
// the hourly session counter, in SQLite.
// The Mirror trusts its caller: the owner secret and session checks are made by the relay routes before a request reaches it.

import { isString } from "../../guards/index.js";
import type { DurableObjectState, SqlStorage } from "./cloudflareRuntime.js";

// CONTRACT: documents/contracts/remote-library.md
/** A stored value is split into chunks of this size, well under the 2 MB SQLite row limit. */
const CHUNK_BYTES = 1024 * 1024;
/** The writer lease expires this long after its last acquire or renew. */
const LEASE_MS = 10 * 60 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rows (path TEXT PRIMARY KEY, kind TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chunks (path TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (path, seq));
CREATE TABLE IF NOT EXISTS owner (one INTEGER PRIMARY KEY CHECK (one = 1), email TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lease (one INTEGER PRIMARY KEY CHECK (one = 1), device TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (one INTEGER PRIMARY KEY CHECK (one = 1), hour INTEGER NOT NULL, count INTEGER NOT NULL);
`;

/** The paths the Worker uses to reach the Mirror. */
export const MIRROR_PATH = { owner: "/owner", lease: "/lease", rows: "/rows", index: "/index", file: "/file", sessions: "/sessions" } as const;

/** One row a sync puts: its library-relative path, its metadata and its whole text value. */
interface MirrorPutRow { path: string; kind: string; hash: string; size: number; value: string }
/** One row of `GET /index`; `updated` is epoch ms. */
interface MirrorIndexEntry { path: string; kind: string; hash: string; size: number; updated: number }
type MirrorLeaseAction = "acquire" | "renew" | "release";

class MirrorStorage {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(SCHEMA);
  }

  put(row: MirrorPutRow, now: number): void {
    this.remove(row.path);
    const bytes = new TextEncoder().encode(row.value);
    this.sql.exec(
      "INSERT INTO rows (path, kind, hash, size, updated) VALUES (?, ?, ?, ?, ?)",
      row.path, row.kind, row.hash, bytes.byteLength, now,
    );
    for (let seq = 0, at = 0; seq === 0 || at < bytes.byteLength; seq += 1, at += CHUNK_BYTES) {
      this.sql.exec("INSERT INTO chunks (path, seq, data) VALUES (?, ?, ?)", row.path, seq, bytes.slice(at, at + CHUNK_BYTES).buffer);
    }
  }

  remove(path: string): void {
    this.sql.exec("DELETE FROM rows WHERE path = ?", path);
    this.sql.exec("DELETE FROM chunks WHERE path = ?", path);
  }

  index(): MirrorIndexEntry[] {
    return this.sql.exec<MirrorIndexEntry>("SELECT path, kind, hash, size, updated FROM rows ORDER BY path").toArray()
      .map(({ path, kind, hash, size, updated }) => ({ path, kind, hash, size, updated }));
  }

  /** The whole value of a row, its chunks joined in order, or null when the row is not there. */
  read(path: string): Uint8Array | null {
    const row = this.sql.exec<{ size: number }>("SELECT size FROM rows WHERE path = ?", path).toArray()[0];
    if (!row) { return null; }
    const out = new Uint8Array(row.size);
    let at = 0;
    for (const { data } of this.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM chunks WHERE path = ? ORDER BY seq", path)) {
      const chunk = new Uint8Array(data);
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }

  clear(): void {
    this.sql.exec("DELETE FROM rows");
    this.sql.exec("DELETE FROM chunks");
    this.sql.exec("DELETE FROM owner");
  }

  owner(): string | null {
    return this.sql.exec<{ email: string }>("SELECT email FROM owner WHERE one = 1").toArray()[0]?.email ?? null;
  }

  setOwner(email: string): void {
    this.sql.exec("INSERT INTO owner (one, email) VALUES (1, ?) ON CONFLICT (one) DO UPDATE SET email = excluded.email", email);
  }

  /** Counts one session request in `hour`; true while the hour's count stays within `limit`. A spent hour counts no further. */
  countSession(hour: number, limit: number): boolean {
    const current = this.sql.exec<{ hour: number; count: number }>("SELECT hour, count FROM sessions WHERE one = 1").toArray()[0];
    const count = current?.hour === hour ? current.count : 0;
    if (count >= limit) { return false; }
    this.sql.exec(
      "INSERT INTO sessions (one, hour, count) VALUES (1, ?, ?) ON CONFLICT (one) DO UPDATE SET hour = excluded.hour, count = excluded.count",
      hour, count + 1,
    );
    return true;
  }

  /** Applies a lease action by `deviceId`; true when that device holds the lease afterwards. */
  lease(deviceId: string, action: MirrorLeaseAction, now: number): boolean {
    const current = this.sql.exec<{ device: string; expires: number }>("SELECT device, expires FROM lease WHERE one = 1").toArray()[0];
    const live = current !== undefined && current.expires > now;
    const holder = live && current.device === deviceId;
    if (action === "release") {
      if (holder) { this.sql.exec("DELETE FROM lease"); }
      return false;
    }
    if (action === "renew" ? !holder : live && !holder) { return false; }
    this.sql.exec(
      "INSERT INTO lease (one, device, expires) VALUES (1, ?, ?) ON CONFLICT (one) DO UPDATE SET device = excluded.device, expires = excluded.expires",
      deviceId, now + LEASE_MS,
    );
    return true;
  }
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const badRequest = (): Response => json({ error: "badRequest" }, 400);

const isPutRow = (value: unknown): value is MirrorPutRow => {
  const row = value as Partial<MirrorPutRow> | null;
  return typeof row === "object" && row !== null && isString(row.path) && isString(row.kind) && isString(row.hash)
    && typeof row.size === "number" && isString(row.value);
};

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return undefined; }
}

export class Mirror {
  private readonly storage: MirrorStorage;

  constructor(state: DurableObjectState) {
    this.storage = new MirrorStorage(state.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    switch (route) {
      case `GET ${MIRROR_PATH.owner}`: return json({ email: this.storage.owner() });
      case `PUT ${MIRROR_PATH.owner}`: {
        const body = (await readJson(request)) as { email?: unknown } | undefined;
        if (!isString(body?.email)) { return badRequest(); }
        this.storage.setOwner(body.email);
        return json({});
      }
      case `POST ${MIRROR_PATH.lease}`: {
        const body = (await readJson(request)) as { deviceId?: unknown; action?: unknown } | undefined;
        const action = body?.action;
        if (!isString(body?.deviceId) || (action !== "acquire" && action !== "renew" && action !== "release")) { return badRequest(); }
        return json({ held: this.storage.lease(body.deviceId, action, Date.now()) });
      }
      case `POST ${MIRROR_PATH.rows}`: {
        const body = (await readJson(request)) as { put?: unknown; delete?: unknown } | undefined;
        const put = body?.put ?? [];
        const remove = body?.delete ?? [];
        if (!Array.isArray(put) || !put.every(isPutRow) || !Array.isArray(remove) || !remove.every(isString)) { return badRequest(); }
        const now = Date.now();
        for (const path of remove) { this.storage.remove(path); }
        for (const row of put) { this.storage.put(row, now); }
        return json({});
      }
      case `POST ${MIRROR_PATH.sessions}`: {
        const body = (await readJson(request)) as { hour?: unknown; limit?: unknown } | undefined;
        const hour = body?.hour;
        const limit = body?.limit;
        if (typeof hour !== "number" || !Number.isInteger(hour) || typeof limit !== "number" || !Number.isInteger(limit)) { return badRequest(); }
        return json({ allowed: this.storage.countSession(hour, limit) });
      }
      case `DELETE ${MIRROR_PATH.rows}`: this.storage.clear(); return json({});
      case `GET ${MIRROR_PATH.index}`: return json(this.storage.index());
      case `GET ${MIRROR_PATH.file}`: {
        const path = url.searchParams.get("path");
        const value = path === null ? null : this.storage.read(path);
        if (value === null) { return json({ error: "notFound" }, 404); }
        return new Response(value.buffer as ArrayBuffer, { status: 200, headers: { "Content-Type": "application/octet-stream" } });
      }
      default: return new Response(null, { status: 404 });
    }
  }
}
