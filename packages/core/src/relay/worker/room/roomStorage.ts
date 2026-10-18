// Keeps one share's claim, stored frames and snapshots as rows of its Durable Object's SQLite database.

import { MAX_RELAY_MESSAGE_BYTES, type RelayRow, type RelayServerMessage } from "../../socket/index.js";
import type { SqlStorage, SqlValue } from "../cloudflareRuntime.js";

// TRAP: a stored frame is replayed inside `rows`, whose overhead (32 bytes) exceeds that of `put` (23), so a frame that fits
// a put could never be replayed. Frames are capped here; under 1 MiB they also fit the 2 MB row limit without chunking.
export const MAX_STORED_FRAME_BYTES = MAX_RELAY_MESSAGE_BYTES - 32;
/** Header, doc, flags and count of a `rows` message. */
const ROWS_OVERHEAD = 3 + 16 + 1 + 4;
const PAGE_ROWS = 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS share (one INTEGER PRIMARY KEY CHECK (one = 1), token_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS peer_counter (one INTEGER PRIMARY KEY CHECK (one = 1), last INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS updates (cursor INTEGER PRIMARY KEY, doc TEXT NOT NULL, frame BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS updates_by_doc ON updates (doc, cursor);
CREATE TABLE IF NOT EXISTS snapshots (doc TEXT PRIMARY KEY, covers INTEGER NOT NULL, frame BLOB NOT NULL);
`;

type RowsMessage = Extract<RelayServerMessage, { type: "rows" }>;

const toBlob = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;
const fromBlob = (value: SqlValue): Uint8Array => new Uint8Array(value as ArrayBuffer);

export class RoomStorage {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(SCHEMA);
  }

  tokenHash(): string | undefined {
    return this.sql.exec<{ token_hash: string }>("SELECT token_hash FROM share").toArray()[0]?.token_hash;
  }

  /** True when the share is claimed with this hash, now or before. */
  claim(tokenHash: string): boolean {
    const existing = this.tokenHash();
    if (existing === undefined) { this.sql.exec("INSERT INTO share (one, token_hash) VALUES (1, ?)", tokenHash); }
    return (existing ?? tokenHash) === tokenHash;
  }

  /** Persisted, so ids stay unique across hibernation; starts at 1 because 0 means every peer. */
  nextPeerId(): number {
    return this.sql.exec<{ last: number }>(
      "INSERT INTO peer_counter (one, last) VALUES (1, 1) ON CONFLICT (one) DO UPDATE SET last = last + 1 RETURNING last",
    ).toArray()[0]!.last;
  }

  // INVARIANT: snapshots are never deleted and each one's `covers` is at least every row it deleted, so the larger of the
  // two maxima is the last cursor ever given, without a counter row written per put.
  private lastCursor(): number {
    const row = this.sql.exec<{ last: number | null }>(
      "SELECT MAX(c) AS last FROM (SELECT MAX(cursor) AS c FROM updates UNION ALL SELECT MAX(covers) AS c FROM snapshots)",
    ).toArray()[0];
    return row?.last ?? 0;
  }

  put(doc: string, frame: Uint8Array): number {
    const cursor = this.lastCursor() + 1;
    this.sql.exec("INSERT INTO updates (cursor, doc, frame) VALUES (?, ?, ?)", cursor, doc, toBlob(frame));
    return cursor;
  }

  private snapshotOf(doc: string): { covers: number; frame: Uint8Array } | undefined {
    const row = this.sql.exec<{ covers: number; frame: SqlValue }>("SELECT covers, frame FROM snapshots WHERE doc = ?", doc).toArray()[0];
    return row ? { covers: row.covers, frame: fromBlob(row.frame) } : undefined;
  }

  /** One page of `rows`, kept under the message cap; `more` asks the client to continue from its last cursor. */
  since(doc: string, cursor: number): RowsMessage {
    const stored = this.snapshotOf(doc);
    const snapshot = stored && stored.covers > cursor ? stored : undefined;
    let size = ROWS_OVERHEAD + (snapshot ? 8 + snapshot.frame.length : 0);
    const items: RelayRow[] = [];
    let more = false;
    const rows = this.sql.exec<{ cursor: number; frame: SqlValue }>(
      "SELECT cursor, frame FROM updates WHERE doc = ? AND cursor > ? ORDER BY cursor LIMIT ?", doc, Math.max(cursor, snapshot?.covers ?? 0), PAGE_ROWS,
    );
    for (const row of rows) {
      const frame = fromBlob(row.frame);
      if (size + 8 + frame.length > MAX_RELAY_MESSAGE_BYTES) { more = true; break; }
      size += 8 + frame.length;
      items.push({ cursor: row.cursor, frame });
    }
    return { type: "rows", doc, more: more || items.length === PAGE_ROWS, ...(snapshot ? { snapshot } : {}), items };
  }

  /** Replaces the doc's snapshot and deletes the rows it covers; false for a stale snapshot. */
  snapshot(doc: string, covers: number, frame: Uint8Array): boolean {
    const storedCovers = this.snapshotOf(doc)?.covers ?? 0;
    const lastRow = this.sql.exec<{ last: number | null }>("SELECT MAX(cursor) AS last FROM updates WHERE doc = ?", doc).toArray()[0]?.last ?? 0;
    if (covers <= storedCovers || covers > Math.max(lastRow, storedCovers)) { return false; }
    this.sql.exec(
      "INSERT INTO snapshots (doc, covers, frame) VALUES (?, ?, ?) ON CONFLICT (doc) DO UPDATE SET covers = excluded.covers, frame = excluded.frame",
      doc, covers, toBlob(frame),
    );
    this.sql.exec("DELETE FROM updates WHERE doc = ? AND cursor <= ?", doc, covers);
    return true;
  }
}
