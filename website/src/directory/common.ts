// Shared pieces of the directory routes (documents/contracts/directory.md): D1 and env types, limits, CORS, error answers, the caller's email and the row and counter queries.
import { bytesToBase64Url } from "@labshelf/core";

// PLATFORM: no @cloudflare/workers-types in the repo, so the slice of D1 the directory calls is declared here.
interface D1PreparedStatement {
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

export const LIMITS = {
  registerPerHour: 10,
  lookupPerHour: 30,
  selfPerHour: 30,
  selfPerDay: 100,
  sendPerSenderDay: 20,
  sendPerPairDay: 3,
  sendPerRecipientDay: 10,
  requestsPerDay: 50_000,
  writesPerDay: 50_000,
} as const;

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
};

export class Refusal extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } });
}

/** The error answer for a thrown value; anything but a Refusal becomes unavailable, never echoed since it may carry a row's inbox or the caller's request. */
export function errorResponse(error: unknown): Response {
  if (error instanceof Refusal) { return json({ error: error.code }, STATUS[error.code]); }
  return json({ error: "unavailable" }, 503);
}

export const encoder = new TextEncoder();

export function day(now: number): string { return new Date(now).toISOString().slice(0, 10); }
export function hour(now: number): string { return new Date(now).toISOString().slice(0, 13); }

/** Resolves the bearer Cloudflare token to the account email with one GET /user; the token goes nowhere else. */
export async function callerEmail(request: Request, deps: DirectoryDeps): Promise<string> {
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

export async function emailKey(env: DirectoryEnv, email: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.DIRECTORY_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(email.trim().toLowerCase()))));
}

export interface Row { inboxUrl: string; inboxToken: string; encryptionKey: string; signingKey: string }

export async function findRow(db: D1Database, key: string): Promise<Row | null> {
  return db.prepare("SELECT inboxUrl, inboxToken, encryptionKey, signingKey FROM directory WHERE emailKey = ?1").bind(key).first<Row>();
}

interface Counter { count: number; peers: string[] }

/** A counter's value in `period`; a row left from an earlier period counts as zero. */
export async function readCounter(db: D1Database, key: string, period: string): Promise<Counter> {
  const row = await db.prepare("SELECT count, peers FROM counters WHERE key = ?1 AND period = ?2").bind(key, period).first<{ count: number; peers: string }>();
  return row ? { count: row.count, peers: row.peers ? row.peers.split(",") : [] } : { count: 0, peers: [] };
}

/** Adds one to a counter in `period` (resetting a row from an earlier period) and appends `peer` to its peer list when given. */
export async function bumpCounter(db: D1Database, key: string, period: string, peer = ""): Promise<void> {
  await db.prepare(
    "INSERT INTO counters(key, period, count, peers) VALUES (?1, ?2, 1, ?3) ON CONFLICT(key) DO UPDATE SET "
    + "count = CASE WHEN period = ?2 THEN count + 1 ELSE 1 END, "
    + "peers = CASE WHEN period = ?2 AND peers <> '' AND ?3 <> '' THEN peers || ',' || ?3 WHEN period = ?2 AND ?3 = '' THEN peers ELSE ?3 END, "
    + "period = ?2",
  ).bind(key, period, peer).run();
}
