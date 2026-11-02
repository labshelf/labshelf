// Holds the owner's inbox as a Durable Object: the sealed invites waiting for the owner and each sender's daily count, in SQLite.

import { bytesToBase64Url } from "../../encoding/index.js";
import { canonicalJson } from "../../collab/invite/identity.js";
import type { InboxInvite, SealedEnvelope } from "../relayHttp.js";
import type { InboxState, SqlStorage } from "./cloudflareRuntime.js";

// CONTRACT: documents/contracts/relay.md#inbox
const MAX_SEALED_BYTES = 16 * 1024;
const MAX_PENDING = 50;
const MAX_PER_SENDER_DAY = 10;
const DAY_MS = 24 * 3600 * 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS invites (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, sealed TEXT NOT NULL, sender TEXT NOT NULL, received INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS sent (sender TEXT NOT NULL, day INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (sender, day));
`;

/** The paths the Worker uses to reach the inbox; `post` takes `{sealed, from}` JSON, `delete` the id as text. */
export const INBOX_PATH = { post: "/post", list: "/list", delete: "/delete" } as const;

/** What the inbox answers a post with; the Worker turns it into the relay's answer or refusal. */
export type InboxPostOutcome = { id: string } | { error: "tooLarge" | "inboxFull" | "rateLimited" };

/** An invite's id: the SHA-256 of its canonical JSON, base64url. */
export async function deriveInviteId(sealedText: string): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sealedText))));
}

export const canonicalSealed = (sealed: SealedEnvelope): string => canonicalJson(sealed as Parameters<typeof canonicalJson>[0]);

class InboxStorage {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(SCHEMA);
  }

  /** Drops the expired invites and the counts of earlier days. */
  prune(now: number): void {
    this.sql.exec("DELETE FROM invites WHERE expires <= ?", now);
    this.sql.exec("DELETE FROM sent WHERE day < ?", Math.floor(now / DAY_MS));
  }

  has(id: string): boolean {
    return this.sql.exec("SELECT 1 AS one FROM invites WHERE id = ?", id).toArray().length > 0;
  }

  pending(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM invites").toArray()[0]!.n;
  }

  sentToday(sender: string, now: number): number {
    return this.sql.exec<{ count: number }>("SELECT count FROM sent WHERE sender = ? AND day = ?", sender, Math.floor(now / DAY_MS)).toArray()[0]?.count ?? 0;
  }

  add(id: string, sealedText: string, sender: string, expires: number, now: number): void {
    this.sql.exec("INSERT INTO invites (id, sealed, sender, received, expires) VALUES (?, ?, ?, ?, ?)", id, sealedText, sender, now, expires);
    this.sql.exec(
      "INSERT INTO sent (sender, day, count) VALUES (?, ?, 1) ON CONFLICT (sender, day) DO UPDATE SET count = count + 1",
      sender, Math.floor(now / DAY_MS),
    );
  }

  list(): InboxInvite[] {
    return this.sql.exec<{ id: string; sealed: string; sender: string; received: number }>(
      "SELECT id, sealed, sender, received FROM invites ORDER BY seq",
    ).toArray().map((row) => ({ id: row.id, sealed: JSON.parse(row.sealed) as SealedEnvelope, from: row.sender, received: row.received }));
  }

  remove(id: string): void {
    this.sql.exec("DELETE FROM invites WHERE id = ?", id);
  }
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

export class Inbox {
  private readonly storage: InboxStorage;

  constructor(ctx: InboxState) {
    this.storage = new InboxStorage(ctx.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const now = Date.now();
    this.storage.prune(now);
    if (path === INBOX_PATH.post) {
      const { sealed, from } = (await request.json()) as { sealed: SealedEnvelope; from: string };
      return json(await this.post(sealed, from, now));
    }
    if (path === INBOX_PATH.list) { return json(this.storage.list()); }
    if (path === INBOX_PATH.delete) { this.storage.remove(await request.text()); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 404 });
  }

  /** Checks the limits after the expired invites are dropped; an invite already held is ok again and counts nothing. */
  private async post(sealed: SealedEnvelope, from: string, now: number): Promise<InboxPostOutcome> {
    const sealedText = canonicalSealed(sealed);
    if (new TextEncoder().encode(sealedText).length > MAX_SEALED_BYTES) { return { error: "tooLarge" }; }
    const id = await deriveInviteId(sealedText);
    if (this.storage.has(id)) { return { id }; }
    if (this.storage.pending() >= MAX_PENDING) { return { error: "inboxFull" }; }
    if (this.storage.sentToday(from, now) >= MAX_PER_SENDER_DAY) { return { error: "rateLimited" }; }
    this.storage.add(id, sealedText, from, sealed.expires, now);
    return { id };
  }
}
