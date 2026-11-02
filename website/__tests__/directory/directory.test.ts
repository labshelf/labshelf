// Pins the directory API of documents/contracts/directory.md on a fake D1 (node:sqlite running the real migration) and a fake fetch.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { base64UrlToBytes, bytesToBase64, bytesToBase64Url, canonicalJson, fingerprint, generateIdentity, publicKeys } from "@labshelf/core";

import { handleDirectoryRequest, type D1Database, type DirectoryEnv } from "../../src/directory/index";

const SECRET = "directory-secret-for-tests";
const ORIGIN = "https://labshelf.org";
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 2, 10, 0, 0);

type Sqlite = typeof import("node:sqlite");

interface FakeDb {
  d1: D1Database;
  rows<T>(sql: string): T[];
  exec(sql: string): void;
  writes: number;
}

/** A D1 stand-in over an in-memory SQLite that runs the shipped migration and counts rows written. */
function fakeD1(): FakeDb {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as Sqlite;
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(__dirname, "../../migrations/0001_directory.sql"), "utf8"));
  const fake: FakeDb = {
    writes: 0,
    rows: <T>(sql: string) => db.prepare(sql).all() as T[],
    exec: (sql: string) => db.exec(sql),
    d1: undefined as unknown as D1Database,
  };
  const mutates = (sql: string) => /^\s*(insert|update|delete)/i.test(sql);
  const counted = <T>(sql: string, run: () => T): T => {
    const result = run();
    if (mutates(sql)) { fake.writes += Number((db.prepare("SELECT changes() AS n").get() as { n: number }).n); }
    return result;
  };
  type Arg = string | number | null;
  const statement = (sql: string, args: Arg[]) => ({
    bind: (...next: Arg[]) => statement(sql, next),
    first: async <T>() => counted(sql, () => (db.prepare(sql).get(...args) ?? null) as T | null),
    all: async <T>() => counted(sql, () => ({ results: db.prepare(sql).all(...args) as T[] })),
    run: async () => counted(sql, () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }),
  });
  fake.d1 = { prepare: (sql: string) => statement(sql, []) } as D1Database;
  return fake;
}

interface InboxCall { url: string; auth: string | null; body: { sealed: unknown; from: string; ts: number; sig: string } }

interface World {
  db: FakeDb;
  env: DirectoryEnv;
  directoryPublicKey: CryptoKey;
  emails: Map<string, string | null>;
  userCalls: string[];
  inbox: InboxCall[];
  inboxStatus: number;
  now: number;
  call(path: string, token: string | undefined, body?: unknown): Promise<{ status: number; text: string; json: Record<string, unknown> }>;
}

async function world(): Promise<World> {
  const db = fakeD1();
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const env: DirectoryEnv = { DB: db.d1, DIRECTORY_SECRET: SECRET, DIRECTORY_SIGNING_KEY: bytesToBase64(pkcs8) };
  const w: World = {
    db, env, directoryPublicKey: pair.publicKey, emails: new Map(), userCalls: [], inbox: [], inboxStatus: 200, now: T0,
    async call(path, token, body) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token !== undefined) { headers.authorization = `Bearer ${token}`; }
      const request = new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: body === undefined ? "" : JSON.stringify(body) });
      const response = await handleDirectoryRequest(request, env, { fetch: fakeFetch, now: () => w.now });
      const text = await response.text();
      return { status: response.status, text, json: text ? JSON.parse(text) as Record<string, unknown> : {} };
    },
  };
  async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    if (request.url === "https://api.cloudflare.com/client/v4/user") {
      const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      w.userCalls.push(token);
      if (!w.emails.has(token)) { return Response.json({ success: false, errors: [{ code: 9109, message: "Unauthorized" }] }, { status: 403 }); }
      const email = w.emails.get(token);
      return Response.json({ success: true, result: email === null ? { id: "u" } : { id: "u", email } });
    }
    if (request.url.endsWith("/inbox")) {
      w.inbox.push({ url: request.url, auth: request.headers.get("authorization"), body: await request.json() as InboxCall["body"] });
      return new Response(w.inboxStatus === 200 ? "{\"ok\":true}" : "{\"error\":\"refused\"}", { status: w.inboxStatus });
    }
    throw new Error(`unexpected fetch ${request.url}`);
  }
  return w;
}

async function emailKey(email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.toLowerCase()))));
}

interface User { token: string; email: string; inboxUrl: string; inboxToken: string; encryptionKey: string; signingKey: string; fingerprint: string }

async function user(w: World, name: string): Promise<User> {
  const keys = await publicKeys(await generateIdentity());
  const u = {
    token: `cf-access-${name}`, email: `${name}@Example.org`, inboxUrl: `https://ls-${name}.acct.workers.dev`, inboxToken: `inbox-token-${name}`,
    ...keys, fingerprint: await fingerprint(keys.encryptionKey, keys.signingKey),
  };
  w.emails.set(u.token, u.email);
  return u;
}

async function register(w: World, u: User) {
  return w.call("/api/directory/register", u.token, { inboxUrl: u.inboxUrl, inboxToken: u.inboxToken, encryptionKey: u.encryptionKey, signingKey: u.signingKey });
}

const SEALED = { v: 1, to: "fp", expires: T0 + 30 * 24 * HOUR, epk: "e", iv: "i", ct: "c" };

describe("directory register and unregister (A1, 6.2a)", () => {
  it("stores one row holding only the email HMAC, inbox URL, inbox token, public keys and time", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const response = await register(w, a);
    expect(response).toMatchObject({ status: 200, json: { ok: true } });
    expect(w.db.rows("SELECT * FROM directory")).toEqual([{
      emailKey: await emailKey("alice@example.org"), inboxUrl: a.inboxUrl, inboxToken: a.inboxToken, encryptionKey: a.encryptionKey, signingKey: a.signingKey, updatedAt: T0,
    }]);
    expect(w.userCalls).toEqual([a.token]);
    const everything = JSON.stringify([w.db.rows("SELECT * FROM directory"), w.db.rows("SELECT * FROM counters"), w.db.rows("SELECT * FROM usage")]).toLowerCase();
    expect(everything).not.toContain("alice@example.org");
    expect(everything).not.toContain(a.token);
  });

  it("replaces the caller's row on a second register", async () => {
    const w = await world();
    const a = await user(w, "alice");
    await register(w, a);
    w.now = T0 + 1000;
    await w.call("/api/directory/register", a.token, { inboxUrl: "https://ls-new.acct.workers.dev", inboxToken: "t2", encryptionKey: a.encryptionKey, signingKey: a.signingKey });
    expect(w.db.rows("SELECT inboxUrl, inboxToken, updatedAt FROM directory")).toEqual([{ inboxUrl: "https://ls-new.acct.workers.dev", inboxToken: "t2", updatedAt: T0 + 1000 }]);
  });

  it("deletes the caller's row on unregister and answers ok when none existed", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    expect(await w.call("/api/directory/unregister", a.token)).toMatchObject({ status: 200, json: { ok: true } });
    expect(w.db.rows<{ emailKey: string }>("SELECT emailKey FROM directory").map((r) => r.emailKey)).toEqual([await emailKey(b.email)]);
    expect(await w.call("/api/directory/unregister", a.token)).toMatchObject({ status: 200, json: { ok: true } });
  });

  it("refuses a malformed registration", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const good = { inboxUrl: a.inboxUrl, inboxToken: a.inboxToken, encryptionKey: a.encryptionKey, signingKey: a.signingKey };
    for (const body of [{ ...good, inboxUrl: "http://plain.example" }, { ...good, inboxToken: "" }, { ...good, signingKey: "nope" }, { ...good, encryptionKey: 4 }]) {
      expect((await w.call("/api/directory/register", a.token, body)).json).toEqual({ error: "bad_request" });
    }
    expect(w.db.rows("SELECT * FROM directory")).toEqual([]);
  });
});

describe("identity (6.2b)", () => {
  it("refuses a missing token, a token /user refuses, and an account without an email", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const body = { inboxUrl: a.inboxUrl, inboxToken: a.inboxToken, encryptionKey: a.encryptionKey, signingKey: a.signingKey };
    expect(await w.call("/api/directory/register", undefined, body)).toMatchObject({ status: 401, json: { error: "unauthorized" } });
    expect(await w.call("/api/directory/register", "bad-token", body)).toMatchObject({ status: 401, json: { error: "unauthorized" } });
    w.emails.set("no-email", null);
    expect(await w.call("/api/directory/register", "no-email", body)).toMatchObject({ status: 401, json: { error: "unauthorized" } });
    expect(w.db.rows("SELECT * FROM directory")).toEqual([]);
  });

  it("refuses lookup and send from a sender without a row", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, b);
    expect((await w.call("/api/directory/lookup", a.token, { email: b.email })).json).toEqual({ error: "unauthorized" });
    expect((await w.call("/api/directory/send", a.token, { email: b.email, sealed: SEALED })).json).toEqual({ error: "unauthorized" });
    expect(w.inbox).toEqual([]);
  });
});

describe("lookup and send (6.2a)", () => {
  it("answers only the recipient's public keys and fingerprint, whatever the email's case", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    const response = await w.call("/api/directory/lookup", a.token, { email: " BOB@example.ORG " });
    expect(response.json).toEqual({ encryptionKey: b.encryptionKey, signingKey: b.signingKey, fingerprint: b.fingerprint });
    expect(response.text).not.toContain(b.inboxUrl);
    expect(response.text).not.toContain(b.inboxToken);
  });

  it("answers not_found for an unregistered email on lookup and send", async () => {
    const w = await world();
    const a = await user(w, "alice");
    await register(w, a);
    expect(await w.call("/api/directory/lookup", a.token, { email: "nobody@example.org" })).toMatchObject({ status: 404, json: { error: "not_found" } });
    expect((await w.call("/api/directory/send", a.token, { email: "nobody@example.org", sealed: SEALED })).json).toEqual({ error: "not_found" });
  });

  it("forwards the sealed invite to the recipient's inbox with a valid directory signature and never returns the inbox", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    w.now = T0 + 5000;
    const response = await w.call("/api/directory/send", a.token, { email: b.email, sealed: SEALED });
    expect(response).toMatchObject({ status: 200, json: { ok: true } });
    expect(response.text).not.toContain(b.inboxUrl);
    expect(response.text).not.toContain(b.inboxToken);
    expect(w.inbox).toHaveLength(1);
    const call = w.inbox[0]!;
    expect(call.url).toBe(`${b.inboxUrl}/inbox`);
    expect(call.auth).toBe(`Bearer ${b.inboxToken}`);
    expect(call.body).toEqual({ sealed: SEALED, from: a.fingerprint, ts: T0 + 5000, sig: expect.any(String) });
    const digest = bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(SEALED)))));
    const message = `labshelf-directory-forward-v1\n${b.fingerprint}\n${digest}\n${T0 + 5000}`;
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, w.directoryPublicKey, base64UrlToBytes(call.body.sig) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(message));
    expect(valid).toBe(true);
    const tampered = `labshelf-directory-forward-v1\n${a.fingerprint}\n${digest}\n${T0 + 5000}`;
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, w.directoryPublicKey, base64UrlToBytes(call.body.sig) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(tampered))).toBe(false);
  });

  it("answers unavailable, without the inbox, when the inbox refuses", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    w.inboxStatus = 429;
    const response = await w.call("/api/directory/send", a.token, { email: b.email, sealed: SEALED });
    expect(response.json).toEqual({ error: "unavailable" });
    expect(response.text).not.toContain(b.inboxUrl);
  });

  it("refuses a sealed invite over 16 KiB as too_large", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    const sealed = { ...SEALED, ct: "x".repeat(16 * 1024) };
    expect(await w.call("/api/directory/send", a.token, { email: b.email, sealed })).toMatchObject({ status: 413, json: { error: "too_large" } });
    expect(w.inbox).toEqual([]);
  });

  it("serves CORS preflight and answers not_found off the directory routes", async () => {
    const w = await world();
    const preflight = await handleDirectoryRequest(new Request(`${ORIGIN}/api/directory/send`, { method: "OPTIONS" }), w.env, { fetch: () => { throw new Error("no fetch"); }, now: () => T0 });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect((await w.call("/api/other", "t", {})).json).toEqual({ error: "not_found" });
    expect(w.userCalls).toEqual([]);
  });
});

describe("limits (A6, 6.2b)", () => {
  it("refuses an 11th register within an hour and allows it the next hour", async () => {
    const w = await world();
    const a = await user(w, "alice");
    for (let i = 0; i < 10; i += 1) { expect((await register(w, a)).json).toEqual({ ok: true }); }
    expect(await register(w, a)).toMatchObject({ status: 429, json: { error: "rate_limited" } });
    w.now = T0 + HOUR;
    expect((await register(w, a)).json).toEqual({ ok: true });
  });

  it("refuses a 31st lookup within an hour per sender", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    for (let i = 0; i < 30; i += 1) { expect((await w.call("/api/directory/lookup", a.token, { email: b.email })).json).toHaveProperty("fingerprint"); }
    expect((await w.call("/api/directory/lookup", a.token, { email: b.email })).json).toEqual({ error: "rate_limited" });
    w.now = T0 + HOUR;
    expect((await w.call("/api/directory/lookup", a.token, { email: b.email })).json).toHaveProperty("fingerprint");
  });

  it("refuses a 4th send to the same recipient in a day", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    await register(w, b);
    for (let i = 0; i < 3; i += 1) { expect((await w.call("/api/directory/send", a.token, { email: b.email, sealed: SEALED })).json).toEqual({ ok: true }); }
    expect((await w.call("/api/directory/send", a.token, { email: b.email, sealed: SEALED })).json).toEqual({ error: "rate_limited" });
    expect(w.inbox).toHaveLength(3);
    w.now = T0 + 24 * HOUR;
    expect((await w.call("/api/directory/send", a.token, { email: b.email, sealed: SEALED })).json).toEqual({ ok: true });
  });

  it("refuses a sender's 21st first contact in a day", async () => {
    const w = await world();
    const a = await user(w, "alice");
    await register(w, a);
    const recipients: User[] = [];
    for (let i = 0; i < 7; i += 1) { const r = await user(w, `r${i}`); await register(w, r); recipients.push(r); }
    for (let i = 0; i < 20; i += 1) {
      expect((await w.call("/api/directory/send", a.token, { email: recipients[i % 7]!.email, sealed: SEALED })).json).toEqual({ ok: true });
    }
    expect((await w.call("/api/directory/send", a.token, { email: recipients[6]!.email, sealed: SEALED })).json).toEqual({ error: "rate_limited" });
    expect(w.inbox).toHaveLength(20);
  });

  it("refuses a recipient's 11th first contact in a day", async () => {
    const w = await world();
    const b = await user(w, "bob");
    await register(w, b);
    const senders: User[] = [];
    for (let i = 0; i < 11; i += 1) { const s = await user(w, `s${i}`); await register(w, s); senders.push(s); }
    for (let i = 0; i < 10; i += 1) { expect((await w.call("/api/directory/send", senders[i]!.token, { email: b.email, sealed: SEALED })).json).toEqual({ ok: true }); }
    expect((await w.call("/api/directory/send", senders[10]!.token, { email: b.email, sealed: SEALED })).json).toEqual({ error: "rate_limited" });
  });

  it("answers unavailable past the global caps without writing, and serves again the next day with past days pruned", async () => {
    const w = await world();
    const a = await user(w, "alice");
    w.db.exec("INSERT INTO usage(day, requests, writes) VALUES ('2026-11-02', 50000, 10)");
    w.db.exec("INSERT INTO counters(key, period, count) VALUES ('lookup:old', '2026-11-01T09', 4)");
    const before = w.db.writes;
    expect(await register(w, a)).toMatchObject({ status: 503, json: { error: "unavailable" } });
    expect(w.db.writes).toBe(before);
    expect(w.userCalls).toEqual([]);
    w.db.exec("UPDATE usage SET requests = 10, writes = 50000");
    expect((await register(w, a)).json).toEqual({ error: "unavailable" });
    w.now = T0 + 24 * HOUR;
    expect((await register(w, a)).json).toEqual({ ok: true });
    expect(w.db.rows<{ day: string }>("SELECT day FROM usage").map((r) => r.day)).toEqual(["2026-11-03"]);
    expect(w.db.rows<{ key: string }>("SELECT key FROM counters").map((r) => r.key)).not.toContain("lookup:old");
  });

  it("writes at most three rows per call", async () => {
    const w = await world();
    const a = await user(w, "alice");
    const b = await user(w, "bob");
    await register(w, a);
    const writesFor = async (run: () => Promise<unknown>) => { const before = w.db.writes; await run(); return w.db.writes - before; };
    expect(await writesFor(() => register(w, b))).toBeLessThanOrEqual(3);
    expect(await writesFor(() => w.call("/api/directory/lookup", a.token, { email: b.email }))).toBeLessThanOrEqual(2);
    expect(await writesFor(() => w.call("/api/directory/send", a.token, { email: b.email, sealed: SEALED }))).toBeLessThanOrEqual(3);
    expect(await writesFor(() => w.call("/api/directory/unregister", b.token))).toBeLessThanOrEqual(2);
  });
});
