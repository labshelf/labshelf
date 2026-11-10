// Answers the relay's /mirror/* routes: owner-secret writes to the Mirror, the exchange of the owner's Cloudflare access token for a
// short page session, and the session-token reads of the remote library's index and files.

import { RELAY_PROTOCOL_VERSION } from "../protocolVersion.js";
import { MIRROR_ROUTE } from "../relayPaths.js";
import {
  bearerOf, checkOwnerSecret, CORS_HEADERS, createBytesAnswer, createNotFoundAnswer, createPreflightAnswer, createRefusal,
  signWithOwnerSecret, verifyOwnerSecretMac,
} from "./relayAnswers.js";
import type { CloudflareStubLike, RelayEnv } from "./cloudflareRuntime.js";
import { MIRROR_PATH } from "./mirror.js";

// CONTRACT: documents/contracts/remote-library.md#routes
/** A `POST /mirror/rows` body above this is refused `tooLarge`; a sync splits its rows across requests. */
const MAX_ROWS_BYTES = 1024 * 1024;
// CONTRACT: documents/contracts/remote-library.md#page-session
const SESSION_MS = 4 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Session requests a Worker answers per hour; more are refused `rateLimited` until the next hour. */
const SESSIONS_PER_HOUR = 60;
const SESSION_PURPOSE = "mirror-session";
const SESSION_PATTERN = /^([1-9]\d{0,15})\.([A-Za-z0-9_-]{43})$/;
const CLOUDFLARE_USER_URL = "https://api.cloudflare.com/client/v4/user";

type MirrorRouteDeps = { fetch: typeof fetch; now(): number };

const mirrorOf = (env: RelayEnv): CloudflareStubLike => env.MIRROR.get(env.MIRROR.idFromName("mirror"));

const askMirror = (env: RelayEnv, path: string, init: RequestInit = {}): Promise<Response> =>
  mirrorOf(env).fetch(new Request(`https://mirror${path}`, init));

function answerJson(fields: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ v: RELAY_PROTOCOL_VERSION, ...fields }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Passes a Mirror answer on: its JSON fields with `v` on success, `malformed` for a body it refused. */
async function relayMirrorAnswer(response: Response): Promise<Response> {
  if (!response.ok) { return createRefusal("malformed"); }
  return answerJson((await response.json()) as Record<string, unknown>);
}

async function mintSession(ownerSecret: string, now: number): Promise<{ session: string; expires: number }> {
  const expires = now + SESSION_MS;
  return { session: `${expires}.${await signWithOwnerSecret(ownerSecret, SESSION_PURPOSE, String(expires))}`, expires };
}

/** False for a missing, malformed, forged or expired session; the Worker keeps no session and recomputes the HMAC. */
async function hasValidSession(request: Request, env: RelayEnv, now: number): Promise<boolean> {
  const match = SESSION_PATTERN.exec(bearerOf(request) ?? "");
  if (!match || !env.OWNER_SECRET || Number(match[1]) <= now) { return false; }
  return verifyOwnerSecretMac(env.OWNER_SECRET, SESSION_PURPOSE, match[1]!, match[2]!);
}

/** The email of the Cloudflare account the token belongs to, or undefined when Cloudflare refuses it. The token is used once and dropped. */
async function cloudflareEmailOf(accessToken: string, deps: MirrorRouteDeps): Promise<string | undefined> {
  try {
    const response = await deps.fetch(CLOUDFLARE_USER_URL, { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) { return undefined; }
    const body = (await response.json()) as { success?: unknown; result?: { email?: unknown } | null };
    const email = body.success === true ? body.result?.email : undefined;
    return typeof email === "string" && email.length > 0 ? email : undefined;
  } catch {
    return undefined;
  }
}

// SECURITY: the access token is read here, sent once to Cloudflare and never stored, logged or answered.
async function openSession(request: Request, env: RelayEnv, deps: MirrorRouteDeps): Promise<Response> {
  const now = deps.now();
  const counted = await askMirror(env, MIRROR_PATH.sessions, {
    method: "POST", body: JSON.stringify({ hour: Math.floor(now / HOUR_MS), limit: SESSIONS_PER_HOUR }),
  });
  if (!((await counted.json()) as { allowed?: boolean }).allowed) { return createRefusal("rateLimited"); }
  let accessToken: unknown;
  try { accessToken = ((await request.json()) as { accessToken?: unknown } | null)?.accessToken; } catch { return createRefusal("malformed"); }
  if (typeof accessToken !== "string" || accessToken.length === 0) { return createRefusal("malformed"); }
  const { email: ownerEmail } = (await (await askMirror(env, MIRROR_PATH.owner)).json()) as { email: string | null };
  if (!ownerEmail) { return createRefusal("off"); }
  if (!env.OWNER_SECRET) {
    console.error("relay mirror: OWNER_SECRET is not set, cannot sign sessions");
    return createRefusal("unauthorized");
  }
  const email = await cloudflareEmailOf(accessToken, deps);
  if (email === undefined) { return createRefusal("unauthorized"); }
  if (email.toLowerCase() !== ownerEmail.toLowerCase()) { return createRefusal("otherAccount"); }
  return answerJson(await mintSession(env.OWNER_SECRET, now));
}

async function putRows(request: Request, env: RelayEnv): Promise<Response> {
  if (Number(request.headers.get("Content-Length")) > MAX_ROWS_BYTES) { return createRefusal("tooLarge"); }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_ROWS_BYTES) { return createRefusal("tooLarge"); }
  return relayMirrorAnswer(await askMirror(env, MIRROR_PATH.rows, { method: "POST", body }));
}

async function readFile(env: RelayEnv, encodedPath: string): Promise<Response> {
  let path: string;
  try { path = decodeURIComponent(encodedPath); } catch { return createRefusal("malformed"); }
  if (path.length === 0) { return createRefusal("malformed"); }
  const response = await askMirror(env, `${MIRROR_PATH.file}?${new URLSearchParams({ path }).toString()}`);
  return response.ok ? createBytesAnswer(response.body) : createRefusal("notFound");
}

/** Owner writes, each refused `unauthorized` without the owner secret before the Mirror sees it. */
async function answerOwnerWrite(request: Request, env: RelayEnv, route: string): Promise<Response> {
  const forward = async (path: string): Promise<Response> =>
    relayMirrorAnswer(await askMirror(env, path, { method: request.method, body: await request.text() }));
  switch (route) {
    case `PUT ${MIRROR_ROUTE.owner}`: return forward(MIRROR_PATH.owner);
    case `POST ${MIRROR_ROUTE.lease}`: return forward(MIRROR_PATH.lease);
    case `POST ${MIRROR_ROUTE.rows}`: return putRows(request, env);
    case `DELETE ${MIRROR_ROUTE.rows}`: return relayMirrorAnswer(await askMirror(env, MIRROR_PATH.rows, { method: "DELETE" }));
    default: return createNotFoundAnswer();
  }
}

const OWNER_WRITES = new Set([
  `PUT ${MIRROR_ROUTE.owner}`, `POST ${MIRROR_ROUTE.lease}`, `POST ${MIRROR_ROUTE.rows}`, `DELETE ${MIRROR_ROUTE.rows}`,
]);

/** Answers a /mirror/* request, or undefined for any other path so the relay's other routes answer it. */
export async function answerMirrorRequest(request: Request, env: RelayEnv, deps: { fetch: typeof fetch; now(): number }): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(MIRROR_ROUTE.prefix)) { return undefined; }
  if (request.method === "OPTIONS") { return createPreflightAnswer(); }
  const route = `${request.method} ${url.pathname}`;
  if (OWNER_WRITES.has(route)) {
    if (!(await checkOwnerSecret(request, env, "mirror"))) { return createRefusal("unauthorized"); }
    return answerOwnerWrite(request, env, route);
  }
  if (route === `POST ${MIRROR_ROUTE.session}`) { return openSession(request, env, deps); }
  const isIndex = route === `GET ${MIRROR_ROUTE.index}`;
  const isFile = request.method === "GET" && url.pathname.startsWith(MIRROR_ROUTE.file);
  if (!isIndex && !isFile) { return createNotFoundAnswer(); }
  if (!(await hasValidSession(request, env, deps.now()))) { return createRefusal("unauthorized"); }
  if (isFile) { return readFile(env, url.pathname.slice(MIRROR_ROUTE.file.length)); }
  return answerJson({ rows: await (await askMirror(env, MIRROR_PATH.index)).json() });
}
