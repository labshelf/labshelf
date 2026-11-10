// The LabShelf directory (documents/contracts/directory.md): the labshelf-website Worker's /api/directory/* routes over D1, which register a user's inbox and keys under their keyed email and forward first-contact invites to it.
import { base64ToBytes, bytesToBase64Url, canonicalJson, decodePublicKey, fingerprint, isHttpsUrl, type JsonValue } from "@labshelf/core";

import {
  bumpCounter, callerEmail, CORS, day, emailKey, encoder, errorResponse, findRow, hour, json, LIMITS, readCounter, Refusal,
  type D1Database, type DirectoryDeps, type DirectoryEnv, type Row,
} from "./common";
import { BUSYTEX_PREFIX, handleBusytexRequest, type AssetBucket } from "./busytexAssets";
import { proxyOauthToken } from "./oauthToken";
import { self } from "./self";

export type { D1Database, DirectoryDeps, DirectoryEnv } from "./common";

const FORWARD_LABEL = "labshelf-directory-forward-v1";
const SEALED_MAX_BYTES = 16 * 1024;
const BODY_MAX_BYTES = SEALED_MAX_BYTES + 4096;
const FIELD_MAX = 2048;
const EMAIL_MAX = 320;

/** Upper bound of rows each route writes, the global usage row included; charged before the route runs. */
const ROUTE_WRITES = { register: 3, unregister: 2, lookup: 2, send: 3, self: 3, oauthToken: 1 } as const;
type Route = keyof typeof ROUTE_WRITES;

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

function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") { throw new Refusal("bad_request"); }
  const email = value.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+$/.test(email)) { throw new Refusal("bad_request"); }
  return email;
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
  "/api/directory/self": "self",
  "/api/oauth/token": "oauthToken",
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
      case "self": return await self(request, env, deps, now);
      case "oauthToken": return await proxyOauthToken(request, deps);
    }
  } catch (error) {
    return errorResponse(error);
  }
}

/** The website Worker's bindings: the directory's, plus the R2 bucket holding the browser LaTeX engine. */
interface WebsiteEnv extends DirectoryEnv { ASSETS_BUCKET: AssetBucket }

/**
 * The website Worker entry named by wrangler.jsonc `main`: /busytex/* from R2, every other routed path (/api/*) to the directory.
 * @public
 */
export default {
  fetch: (request: Request, env: WebsiteEnv, ctx: { waitUntil(promise: Promise<unknown>): void }) => {
    if (new URL(request.url).pathname.startsWith(BUSYTEX_PREFIX)) {
      // caches.default is the Workers runtime's edge cache; the DOM typings do not declare it.
      const cache = (caches as unknown as { default: Cache }).default;
      return handleBusytexRequest(request, { bucket: env.ASSETS_BUCKET, cache, waitUntil: (promise) => ctx.waitUntil(promise) });
    }
    return handleDirectoryRequest(request, env);
  },
};
