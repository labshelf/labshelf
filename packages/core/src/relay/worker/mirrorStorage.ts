// The SQLite side of the Mirror Durable Object: its schema and the MirrorStorage class that reads and writes the rows, chunks, settings, edits,
// owner, lease and session counter, plus the refusal a request ends with.

import { bytesToBase64Url } from "../../encoding/index.js";
import type { SqlStorage } from "./cloudflareRuntime.js";

// CONTRACT: documents/contracts/remote-library.md
/** A value in store `do` is split into chunks of this size, under the SQLite row limit. */
const CHUNK_BYTES = 7 * 1024 * 1024;
/** The writer lease expires this long after its last acquire or renew. */
const LEASE_MS = 10 * 60 * 1000;
/** The default limit of store `do`, and the most a `do` limit may be set to. */
export const DO_LIMIT_BYTES = 5_000_000_000;
const R2_LIMIT_BYTES = 9_000_000_000;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS rows (path TEXT PRIMARY KEY, kind TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chunks (path TEXT NOT NULL, seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (path, seq));
CREATE TABLE IF NOT EXISTS owner (one INTEGER PRIMARY KEY CHECK (one = 1), email TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lease (one INTEGER PRIMARY KEY CHECK (one = 1), device TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (one INTEGER PRIMARY KEY CHECK (one = 1), hour INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (one INTEGER PRIMARY KEY CHECK (one = 1), generation TEXT NOT NULL, store TEXT NOT NULL,
  limit_bytes INTEGER, include_pdfs INTEGER NOT NULL, ops_month TEXT NOT NULL, ops_count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS edits (path TEXT PRIMARY KEY, base TEXT NOT NULL, hash TEXT NOT NULL, deleted INTEGER NOT NULL, at INTEGER NOT NULL);
`;

type MirrorStore = "do" | "r2";
/** A row about to be written, its value as bytes. */
export interface MirrorWrite { path: string; kind: string; hash: string; bytes: Uint8Array }
/** One row of `GET /index`; `updated` is epoch ms. */
interface MirrorIndexEntry { path: string; kind: string; hash: string; size: number; updated: number }
interface MirrorEdit { path: string; base: string; hash: string; deleted: boolean; at: number }
interface MirrorSettings { generation: string; store: MirrorStore; limitBytes: number | null; includePdfs: boolean; opsMonth: string; opsCount: number }
type MirrorLeaseAction = "acquire" | "renew" | "release";

/** A request the Mirror refuses; `fetch` answers it as `{error, ...details}`, which the relay passes on with the refusal's status. */
export class MirrorRefusal extends Error {
  constructor(readonly kind: "malformed" | "notFound" | "conflict" | "full" | "noBucket", readonly details: Record<string, unknown> = {}) {
    super(kind);
  }
}

export const refuseFull = (reason: "storage" | "operations") => new MirrorRefusal("full", { reason });

const utcMonthOf = (now: number): string => new Date(now).toISOString().slice(0, 7);

export class MirrorStorage {
  constructor(private readonly sql: SqlStorage, private readonly transaction: <T>(work: () => T) => T) {
    sql.exec(SCHEMA);
  }

  /** The settings, written with a new generation and store `do` the first time they are read. */
  settings(): MirrorSettings {
    const row = this.sql.exec<{
      generation: string; store: MirrorStore; limit_bytes: number | null; include_pdfs: number; ops_month: string; ops_count: number;
    }>("SELECT generation, store, limit_bytes, include_pdfs, ops_month, ops_count FROM settings WHERE one = 1").toArray()[0];
    if (!row) {
      const fresh: MirrorSettings = { generation: drawGeneration(), store: "do", limitBytes: null, includePdfs: false, opsMonth: "", opsCount: 0 };
      this.writeSettings(fresh);
      return fresh;
    }
    return {
      generation: row.generation, store: row.store, limitBytes: row.limit_bytes, includePdfs: row.include_pdfs === 1,
      opsMonth: row.ops_month, opsCount: row.ops_count,
    };
  }

  writeSettings(settings: MirrorSettings): void {
    this.sql.exec(
      `INSERT INTO settings (one, generation, store, limit_bytes, include_pdfs, ops_month, ops_count) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (one) DO UPDATE SET generation = excluded.generation, store = excluded.store, limit_bytes = excluded.limit_bytes,
       include_pdfs = excluded.include_pdfs, ops_month = excluded.ops_month, ops_count = excluded.ops_count`,
      settings.generation, settings.store, settings.limitBytes, settings.includePdfs ? 1 : 0, settings.opsMonth, settings.opsCount,
    );
  }

  /** The R2 operations counted in the UTC month of `now`; a past month counts as none. */
  operations(now: number): { month: string; operations: number } {
    const { opsMonth, opsCount } = this.settings();
    const month = utcMonthOf(now);
    return { month, operations: opsMonth === month ? opsCount : 0 };
  }

  countOperations(count: number, now: number): void {
    const { month, operations } = this.operations(now);
    this.writeSettings({ ...this.settings(), opsMonth: month, opsCount: operations + count });
  }

  used(): number {
    return this.sql.exec<{ used: number | null }>("SELECT SUM(size) AS used FROM rows").toArray()[0]?.used ?? 0;
  }

  limit(settings: MirrorSettings): number {
    return settings.limitBytes ?? (settings.store === "r2" ? R2_LIMIT_BYTES : DO_LIMIT_BYTES);
  }

  sizeOf(path: string): number {
    return this.row(path)?.size ?? 0;
  }

  row(path: string): MirrorIndexEntry | undefined {
    return this.sql.exec<MirrorIndexEntry>("SELECT path, kind, hash, size, updated FROM rows WHERE path = ?", path).toArray()[0];
  }

  count(table: "rows" | "edits"): number {
    return this.sql.exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`).toArray()[0]?.count ?? 0;
  }

  /** Writes a row's metadata, and in store `do` its chunks, in one transaction; a refused write is `full` with reason storage. */
  writeRow(write: MirrorWrite, store: MirrorStore, now: number): void {
    // TRAP: Cloudflare refuses SQLite writes once the account's Durable Object storage is full; the write throws.
    try {
      this.transaction(() => {
        this.removeRow(write.path);
        this.sql.exec(
          "INSERT INTO rows (path, kind, hash, size, updated) VALUES (?, ?, ?, ?, ?)",
          write.path, write.kind, write.hash, write.bytes.byteLength, now,
        );
        if (store === "r2") { return; }
        for (let seq = 0, at = 0; seq === 0 || at < write.bytes.byteLength; seq += 1, at += CHUNK_BYTES) {
          this.sql.exec("INSERT INTO chunks (path, seq, data) VALUES (?, ?, ?)", write.path, seq, write.bytes.slice(at, at + CHUNK_BYTES).buffer);
        }
      });
    } catch {
      throw refuseFull("storage");
    }
  }

  removeRow(path: string): void {
    this.sql.exec("DELETE FROM rows WHERE path = ?", path);
    this.sql.exec("DELETE FROM chunks WHERE path = ?", path);
  }

  index(): MirrorIndexEntry[] {
    return this.sql.exec<MirrorIndexEntry>("SELECT path, kind, hash, size, updated FROM rows ORDER BY path").toArray()
      .map(({ path, kind, hash, size, updated }) => ({ path, kind, hash, size, updated }));
  }

  /** The chunks of a row in store `do` joined in order. */
  readChunks(path: string, size: number): Uint8Array {
    const out = new Uint8Array(size);
    let at = 0;
    for (const { data } of this.sql.exec<{ data: ArrayBuffer }>("SELECT data FROM chunks WHERE path = ? ORDER BY seq", path)) {
      const chunk = new Uint8Array(data);
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }

  /** Drops every row, chunk and edit and draws a new generation, so no R2 key of the old one is read again. */
  clearRows(): void {
    this.transaction(() => {
      this.sql.exec("DELETE FROM rows");
      this.sql.exec("DELETE FROM chunks");
      this.sql.exec("DELETE FROM edits");
      this.writeSettings({ ...this.settings(), generation: drawGeneration() });
    });
  }

  edits(): MirrorEdit[] {
    return this.sql.exec<{ path: string; base: string; hash: string; deleted: number; at: number }>(
      "SELECT path, base, hash, deleted, at FROM edits ORDER BY at, path",
    ).toArray().map(({ path, base, hash, deleted, at }) => ({ path, base, hash, deleted: deleted === 1, at }));
  }

  /** Records an edit, keeping the earliest unacknowledged base and the latest hash. */
  recordEdit(path: string, base: string, hash: string, deleted: boolean, now: number): void {
    try {
      this.sql.exec(
        `INSERT INTO edits (path, base, hash, deleted, at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET hash = excluded.hash, deleted = excluded.deleted, at = excluded.at`,
        path, base, hash, deleted ? 1 : 0, now,
      );
    } catch {
      throw refuseFull("storage");
    }
  }

  ackEdit(path: string, hash: string): void {
    this.sql.exec("DELETE FROM edits WHERE path = ? AND hash = ?", path, hash);
  }

  owner(): string | null {
    return this.sql.exec<{ email: string }>("SELECT email FROM owner WHERE one = 1").toArray()[0]?.email ?? null;
  }

  setOwner(email: string): void {
    this.sql.exec("INSERT INTO owner (one, email) VALUES (1, ?) ON CONFLICT (one) DO UPDATE SET email = excluded.email", email);
  }

  clearOwner(): void {
    this.sql.exec("DELETE FROM owner");
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

/** A generation names the R2 keys of one Mirror content: 16 random bytes, base64url. */
const drawGeneration = (): string => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)));

