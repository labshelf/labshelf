// The LabShelf directory (documents/contracts/directory.md): the labshelf-website Worker's /api/directory/* routes over D1, which register a user's inbox and keys under their keyed email and forward first-contact invites to it.
import { base64ToBytes, bytesToBase64Url, canonicalJson, decodePublicKey, fingerprint, isHttpsUrl, type JsonValue } from "@labshelf/core";

// PLATFORM: no @cloudflare/workers-types in the repo, so the slice of D1 the directory calls is declared here.
export interface D1PreparedStatement {
  bind(...values: (string | number | null)[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

export interface DirectoryEnv {
  DB: D1Database;
  /** HMAC key for email keys. */
  DIRECTORY_SECRET: string;
  /** The directory's ECDSA P-256 private key, PKCS#8 as PEM or base64 DER. */
  DIRECTORY_SIGNING_KEY: string;
}

export interface DirectoryDeps {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  now: () => number;
}

type ErrorCode = "unauthorized" | "not_found" | "rate_limited" | "too_large" | "bad_request" | "unavailable";

const STATUS: Record<ErrorCode, number> = { unauthorized: 401, not_found: 404, rate_limited: 429, too_large: 413, bad_request: 400, unavailable: 503 };

const USER_URL = "https://api.cloudflare.com/client/v4/user";
const FORWARD_LABEL = "labshelf-directory-forward-v1";
const SEALED_MAX_BYTES = 16 * 1024;
const BODY_MAX_BYTES = SEALED_MAX_BYTES + 4096;
const FIELD_MAX = 2048;
const EMAIL_MAX = 320;

const LIMITS = {
  registerPerHour: 10,
  lookupPerHour: 30,
  sendPerSenderDay: 20,
  sendPerPairDay: 3,
  sendPerRecipientDay: 10,
  requestsPerDay: 50_000,
  writesPerDay: 50_000,
} as const;

/** Upper bound of rows each route writes, the global usage row included; charged before the route runs. */
const ROUTE_WRITES = { register: 3, unregister: 2, lookup: 2, send: 3 } as const;
type Route = keyof typeof ROUTE_WRITES;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

class Refusal extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });
}

const encoder = new TextEncoder();

function day(now: number): string { return new Date(now).toISOString().slice(0, 10); }
function hour(now: number): string { return new Date(now).toISOString().slice(0, 13); }

/** Charges one request and the route's writes to today's usage row, unless a global cap is already reached; prunes past periods on the day's first call. */
async function chargeUsage(db: D1Database, now: number, writes: number): Promise<void> {
  const today = day(now);
  const row = await db.prepare(
    "INSERT INTO usage(day, requests, writes) VALUES (?1, 1, ?2) ON CONFLICT(day) DO UPDATE SET requests = requests + 1, writes = writes + ?2 "
    + "WHERE requests < ?3 AND writes < ?4 RETURNING requests",
  ).bind(today, writes, LIMITS.requestsPerDay, LIMITS.writesPerDay).first<{ requests: number }>();
  if (!row) { throw new Refusal("unavailable"); }
  if (row.requests === 1) {
    await db.prepare("DELETE FROM usage WHERE day < ?1").bind(today).run();
    // Hour periods ("2026-11-01T23") sort after their day ("2026-11-01") and before the next, so this drops every past day and hour.
    await db.prepare("DELETE FROM counters WHERE period < ?1").bind(today).run();
  }
}

/** Resolves the bearer Cloudflare token to the account email with one GET /user; the token goes nowhere else. */
async function callerEmail(request: Request, deps: DirectoryDeps): Promise<string> {
  const match = /^Bearer\s+(\S+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) { throw new Refusal("unauthorized"); }
  let response: Response;
  try {
    response = await deps.fetch(USER_URL, { headers: { authorization: `Bearer ${match[1]}` } });
  } catch {
    throw new Refusal("unavailable");
  }
  if (!response.ok) { throw new Refusal("unauthorized"); }
  const body = await response.json().catch(() => undefined) as { success?: unknown; result?: { email?: unknown } } | undefined;
  // Cloudflare's /user has no verified flag (research/spike.md (a)); an account that signed in and holds the scope is taken as verified.
  const email = body?.success === true ? body.result?.email : undefined;
  if (typeof email !== "string" || !email.includes("@")) { throw new Refusal("unauthorized"); }
  return email;
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") { throw new Refusal("bad_request"); }
  const email = value.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+$/.test(email)) { throw new Refusal("bad_request"); }
  return email;
}

async function emailKey(env: DirectoryEnv, email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.DIRECTORY_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(email.trim().toLowerCase()))));
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (encoder.encode(text).length > BODY_MAX_BYTES) { throw new Refusal("too_large"); }
  if (!text) { return {}; }
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new Refusal("bad_request"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) { throw new Refusal("bad_request"); }
  return body as Record<string, unknown>;
}

function field(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value || value.length > FIELD_MAX) { throw new Refusal("bad_request"); }
  return value;
}

interface Row { inboxUrl: string; inboxToken: string; encryptionKey: string; signingKey: string }

async function findRow(db: D1Database, key: string): Promise<Row | null> {
  return db.prepare("SELECT inboxUrl, inboxToken, encryptionKey, signingKey FROM directory WHERE emailKey = ?1").bind(key).first<Row>();
}

interface Counter { count: number; peers: string[] }

/** A counter's value in `period`; a row left from an earlier period counts as zero. */
async function readCounter(db: D1Database, key: string, period: string): Promise<Counter> {
  const row = await db.prepare("SELECT count, peers FROM counters WHERE key = ?1 AND period = ?2").bind(key, period).first<{ count: number; peers: string }>();
  return row ? { count: row.count, peers: row.peers ? row.peers.split(",") : [] } : { count: 0, peers: [] };
}

/** Adds one to a counter in `period` (resetting a row from an earlier period) and appends `peer` to its peer list when given. */
async function bumpCounter(db: D1Database, key: string, period: string, peer = ""): Promise<void> {
  await db.prepare(
    "INSERT INTO counters(key, period, count, peers) VALUES (?1, ?2, 1, ?3) ON CONFLICT(key) DO UPDATE SET "
    + "count = CASE WHEN period = ?2 THEN count + 1 ELSE 1 END, "
    + "peers = CASE WHEN period = ?2 AND peers <> '' AND ?3 <> '' THEN peers || ',' || ?3 WHEN period = ?2 AND ?3 = '' THEN peers ELSE ?3 END, "
    + "period = ?2",
  ).bind(key, period, peer).run();
}

async function register(request: Request, env: DirectoryEnv, deps: DirectoryDeps, now: number): Promise<Response> {
  const key = await emailKey(env, await callerEmail(request, deps));
  const body = await readBody(request);
  const inboxUrl = field(body, "inboxUrl");
  const inboxToken = field(body, "inboxToken");
  const encryptionKey = field(body, "encryptionKey");
  const signingKey = field(body, "signingKey");
  if (!isHttpsUrl(inboxUrl) || !decodePublicKey(encryptionKey) || !decodePublicKey(signingKey)) { throw new Refusal("bad_request"); }
  const counterKey = `register:${key}`;
  if ((await readCounter(env.DB, counterKey, hour(now))).count >= LIMITS.registerPerHour) { throw new Refusal("rate_limited"); }
  await bumpCounter(env.DB, counterKey, hour(now));
  await env.DB.prepare(
    "INSERT INTO directory(emailKey, inboxUrl, inboxToken, encryptionKey, signingKey, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6) "
    + "ON CONFLICT(emailKey) DO UPDATE SET inboxUrl = ?2, inboxToken = ?3, encryptionKey = ?4, signingKey = ?5, updatedAt = ?6",
  ).bind(key, inboxUrl, inboxToken, encryptionKey, signingKey, now).run();
  return json({ ok: true });
}

async function unregister(request: Request, env: DirectoryEnv, deps: DirectoryDeps): Promise<Response> {
  const key = await emailKey(env, await callerEmail(request, deps));
  await env.DB.prepare("DELETE FROM directory WHERE emailKey = ?1").bind(key).run();
  return json({ ok: true });
}

/** The caller's key and row; a caller without a row may not look up or send. */
async function sender(request: Request, env: DirectoryEnv, deps: DirectoryDeps): Promise<{ key: string; row: Row }> {
  const key = await emailKey(env, await callerEmail(request, deps));
  const row = await findRow(env.DB, key);
  if (!row) { throw new Refusal("unauthorized"); }
  return { key, row };
}

async function lookup(request: Request, env: DirectoryEnv, deps: DirectoryDeps, now: number): Promise<Response> {
  const from = await sender(request, env, deps);
  const email = normalizeEmail((await readBody(request)).email);
  const counterKey = `lookup:${from.key}`;
  if ((await readCounter(env.DB, counterKey, hour(now))).count >= LIMITS.lookupPerHour) { throw new Refusal("rate_limited"); }
  await bumpCounter(env.DB, counterKey, hour(now));
  const row = await findRow(env.DB, await emailKey(env, email));
  if (!row) { throw new Refusal("not_found"); }
  return json({ encryptionKey: row.encryptionKey, signingKey: row.signingKey, fingerprint: await fingerprint(row.encryptionKey, row.signingKey) });
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  const der = base64ToBytes(secret.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  return crypto.subtle.importKey("pkcs8", der as Uint8Array<ArrayBuffer>, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The forward body for the recipient's inbox, signed per documents/contracts/directory.md#forward. */
async function forwardBody(env: DirectoryEnv, sealed: JsonValue, sealedText: string, from: string, to: string, ts: number) {
  const digest = bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(sealedText))));
  const message = `${FORWARD_LABEL}\n${to}\n${digest}\n${ts}`;
  const key = await importSigningKey(env.DIRECTORY_SIGNING_KEY);
  const sig = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(message))));
  return { sealed, from, ts, sig };
}

async function send(request: Request, env: DirectoryEnv, deps: DirectoryDeps, now: number): Promise<Response> {
  const from = await sender(request, env, deps);
  const body = await readBody(request);
  const email = normalizeEmail(body.email);
  if (body.sealed === undefined || body.sealed === null || typeof body.sealed !== "object") { throw new Refusal("bad_request"); }
  const sealed = body.sealed as JsonValue;
  const sealedText = canonicalJson(sealed);
  if (encoder.encode(sealedText).length > SEALED_MAX_BYTES) { throw new Refusal("too_large"); }
  const today = day(now);
  const senderKey = `send:${from.key}`;
  const sent = await readCounter(env.DB, senderKey, today);
  if (sent.count >= LIMITS.sendPerSenderDay) { throw new Refusal("rate_limited"); }
  const recipientKey = await emailKey(env, email);
  const recipient = await findRow(env.DB, recipientKey);
  if (!recipient) {
    // An unknown email still spends the sender's quota, so send cannot probe who is registered faster than lookup.
    await bumpCounter(env.DB, senderKey, today);
    throw new Refusal("not_found");
  }
  const received = `recv:${recipientKey}`;
  if (sent.peers.filter((peer) => peer === recipientKey).length >= LIMITS.sendPerPairDay
    || (await readCounter(env.DB, received, today)).count >= LIMITS.sendPerRecipientDay) {
    throw new Refusal("rate_limited");
  }
  await bumpCounter(env.DB, senderKey, today, recipientKey);
  await bumpCounter(env.DB, received, today);
  const forward = await forwardBody(
    env, sealed, sealedText, await fingerprint(from.row.encryptionKey, from.row.signingKey), await fingerprint(recipient.encryptionKey, recipient.signingKey), now,
  );
  try {
    const response = await deps.fetch(`${recipient.inboxUrl.replace(/\/+$/, "")}/inbox`, {
      method: "POST",
      headers: { authorization: `Bearer ${recipient.inboxToken}`, "content-type": "application/json" },
      body: JSON.stringify(forward),
    });
    if (!response.ok) { throw new Refusal("unavailable"); }
  } catch {
    // Neither the inbox's answer nor its address reaches the sender.
    throw new Refusal("unavailable");
  }
  return json({ ok: true });
}

const ROUTES: Record<string, Route> = {
  "/api/directory/register": "register",
  "/api/directory/unregister": "unregister",
  "/api/directory/lookup": "lookup",
  "/api/directory/send": "send",
};

/** Answers one /api request; `deps` replaces fetch and the clock in tests. */
export async function handleDirectoryRequest(request: Request, env: DirectoryEnv, deps: DirectoryDeps = { fetch: (input, init) => fetch(input, init), now: () => Date.now() }): Promise<Response> {
  const route = ROUTES[new URL(request.url).pathname];
  if (request.method === "OPTIONS") { return new Response(null, { status: route ? 204 : 404, headers: CORS }); }
  if (!route) { return json({ error: "not_found" }, 404); }
  if (request.method !== "POST") { return json({ error: "bad_request" }, 405); }
  const now = deps.now();
  try {
    await chargeUsage(env.DB, now, ROUTE_WRITES[route]);
    switch (route) {
      case "register": return await register(request, env, deps, now);
      case "unregister": return await unregister(request, env, deps);
      case "lookup": return await lookup(request, env, deps, now);
      case "send": return await send(request, env, deps, now);
    }
  } catch (error) {
    if (error instanceof Refusal) { return json({ error: error.code }, STATUS[error.code]); }
    // Never echo the error: it may carry a row's inbox or the caller's request.
    return json({ error: "unavailable" }, 503);
  }
}

export default {
  fetch: (request: Request, env: DirectoryEnv) => handleDirectoryRequest(request, env),
};
