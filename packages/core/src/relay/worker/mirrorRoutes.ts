// Answers the relay's /mirror/* routes: the owner-secret writes, status, settings and edit reads of the Mirror, the exchange of the owner's
// Cloudflare access token for a short page session, and the page's session-token reads and edits of the remote library.

import { RELAY_PROTOCOL_VERSION } from "../protocolVersion.js";
import { MIRROR_ROUTE } from "../relayPaths.js";
import {
  bearerOf, checkOwnerSecret, CORS_HEADERS, createBytesAnswer, createNotFoundAnswer, createPreflightAnswer, createRefusal,
  isRefusalKind, signWithOwnerSecret, verifyOwnerSecretMac,
} from "./relayAnswers.js";
import type { CloudflareStubLike, RelayEnv } from "./cloudflareRuntime.js";
import { MIRROR_PATH } from "./mirror.js";

// CONTRACT: documents/contracts/remote-library.md#routes
/** A `POST /mirror/rows` body above this is refused `tooLarge`; a sync splits its rows across requests. */
const MAX_ROWS_BYTES = 8 * 1024 * 1024;
/** A `PUT /mirror/file/<path>` or `PUT /mirror/edit/<path>` body above this is refused `tooLarge`. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
// CONTRACT: documents/contracts/remote-library.md#page-session
const SESSION_MS = 4 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Session requests a Worker answers per hour; more are refused `rateLimited` until the next hour. */
const SESSIONS_PER_HOUR = 60;
const SESSION_PURPOSE = "mirror-session";
const SESSION_PATTERN = /^([1-9]\d{0,15})\.([A-Za-z0-9_-]{43})$/;
const CLOUDFLARE_USER_URL = "https://api.cloudflare.com/client/v4/user";
/** The headers of a file or edit request the Mirror reads. */
const FORWARDED_HEADERS = ["x-labshelf-kind", "x-labshelf-hash", "x-labshelf-base"];

type MirrorRouteDeps = { fetch: typeof fetch; now(): number };

const mirrorOf = (env: RelayEnv): CloudflareStubLike => env.MIRROR.get(env.MIRROR.idFromName("mirror"));

const askMirror = (env: RelayEnv, path: string, init: RequestInit = {}): Promise<Response> =>
  mirrorOf(env).fetch(new Request(`https://mirror${path}`, init));

function answerJson(fields: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ v: RELAY_PROTOCOL_VERSION, ...fields }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Passes a Mirror answer on: its JSON fields with `v` on success, its refusal with that refusal's status (`malformed` when unreadable). */
async function relayMirrorAnswer(response: Response): Promise<Response> {
  if (response.ok) { return answerJson((await response.json()) as Record<string, unknown>); }
  let refusal: Record<string, unknown> = {};
  try { refusal = (await response.json()) as Record<string, unknown>; } catch { /* an unreadable refusal is answered malformed */ }
  const { error, ...details } = refusal;
  return isRefusalKind(error) ? createRefusal(error, details) : createRefusal("malformed");
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

/**
 * Streams the request's body to the Mirror, refused `tooLarge` when its Content-Length or its actual length passes `maxBytes`.
 * TRAP: the length is counted while the body streams, so a body longer than its Content-Length fails the Mirror's read and is refused here.
 */
async function forwardBody(request: Request, env: RelayEnv, path: string, maxBytes: number): Promise<Response> {
  if (Number(request.headers.get("Content-Length")) > maxBytes) { return createRefusal("tooLarge"); }
  let seen = 0;
  let over = false;
  const body = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) { over = true; controller.error(new Error("tooLarge")); return; }
      controller.enqueue(chunk);
    },
  })) ?? null;
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) { headers.set(name, value); }
  }
  let answer: Response;
  try {
    // PLATFORM: a streamed request body needs `duplex: "half"` outside Workers; Workers ignore it.
    answer = await askMirror(env, path, { method: request.method, headers, body, duplex: "half" } as RequestInit);
  } catch (error) {
    if (over) { return createRefusal("tooLarge"); }
    throw error;
  }
  return over ? createRefusal("tooLarge") : relayMirrorAnswer(answer);
}

/** The Mirror path of a file or edit route, the row's path as its `path` parameter; undefined for an undecodable or empty path. */
function rowPathOf(pathname: string, prefix: string, mirrorPath: string): string | undefined {
  let path: string;
  try { path = decodeURIComponent(pathname.slice(prefix.length)); } catch { return undefined; }
  return path.length === 0 ? undefined : `${mirrorPath}?${new URLSearchParams({ path }).toString()}`;
}

async function readFile(env: RelayEnv, pathname: string): Promise<Response> {
  const path = rowPathOf(pathname, MIRROR_ROUTE.file, MIRROR_PATH.file);
  if (path === undefined) { return createRefusal("malformed"); }
  const response = await askMirror(env, path);
  return response.ok ? createBytesAnswer(response.body) : relayMirrorAnswer(response);
}

/** Owner routes, reached only after the owner secret was checked. */
async function answerOwnerRoute(request: Request, env: RelayEnv, route: string, pathname: string): Promise<Response> {
  const forward = async (path: string): Promise<Response> => relayMirrorAnswer(await askMirror(env, path, {
    method: request.method, ...(request.method === "GET" || request.method === "DELETE" ? {} : { body: await request.text() }),
  }));
  switch (route) {
    case `PUT ${MIRROR_ROUTE.owner}`: return forward(MIRROR_PATH.owner);
    case `POST ${MIRROR_ROUTE.lease}`: return forward(MIRROR_PATH.lease);
    case `POST ${MIRROR_ROUTE.rows}`: return forwardBody(request, env, MIRROR_PATH.rows, MAX_ROWS_BYTES);
    case `DELETE ${MIRROR_ROUTE.rows}`: return forward(MIRROR_PATH.rows);
    case `GET ${MIRROR_ROUTE.status}`: return forward(MIRROR_PATH.status);
    case `PUT ${MIRROR_ROUTE.settings}`: return forward(MIRROR_PATH.settings);
    case `GET ${MIRROR_ROUTE.edits}`: return forward(MIRROR_PATH.edits);
    case `POST ${MIRROR_ROUTE.editsAck}`: return forward(MIRROR_PATH.editsAck);
    default: {
      const path = rowPathOf(pathname, MIRROR_ROUTE.file, MIRROR_PATH.file);
      return path === undefined ? createRefusal("malformed") : forwardBody(request, env, path, MAX_FILE_BYTES);
    }
  }
}

const OWNER_ROUTES = new Set([
  `PUT ${MIRROR_ROUTE.owner}`, `POST ${MIRROR_ROUTE.lease}`, `POST ${MIRROR_ROUTE.rows}`, `DELETE ${MIRROR_ROUTE.rows}`,
  `GET ${MIRROR_ROUTE.status}`, `PUT ${MIRROR_ROUTE.settings}`, `GET ${MIRROR_ROUTE.edits}`, `POST ${MIRROR_ROUTE.editsAck}`,
]);

/** Answers a /mirror/* request, or undefined for any other path so the relay's other routes answer it. */
export async function answerMirrorRequest(request: Request, env: RelayEnv, deps: MirrorRouteDeps): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(MIRROR_ROUTE.prefix)) { return undefined; }
  if (request.method === "OPTIONS") { return createPreflightAnswer(); }
  const route = `${request.method} ${pathname}`;
  const isFile = pathname.startsWith(MIRROR_ROUTE.file);
  if (OWNER_ROUTES.has(route) || (isFile && request.method === "PUT")) {
    if (!(await checkOwnerSecret(request, env, "mirror"))) { return createRefusal("unauthorized"); }
    return answerOwnerRoute(request, env, route, pathname);
  }
  if (route === `POST ${MIRROR_ROUTE.session}`) { return openSession(request, env, deps); }
  if (isFile && request.method === "GET") {
    // CONTRACT: the owner's page reads a file with a session, a syncing host with the owner secret.
    const allowed = (await hasValidSession(request, env, deps.now())) || (await checkOwnerSecret(request, env, "mirror"));
    return allowed ? readFile(env, pathname) : createRefusal("unauthorized");
  }
  const isIndex = route === `GET ${MIRROR_ROUTE.index}`;
  const isEdit = pathname.startsWith(MIRROR_ROUTE.edit) && (request.method === "PUT" || request.method === "DELETE");
  if (!isIndex && !isEdit) { return createNotFoundAnswer(); }
  if (!(await hasValidSession(request, env, deps.now()))) { return createRefusal("unauthorized"); }
  if (isIndex) { return answerJson({ rows: await (await askMirror(env, MIRROR_PATH.index)).json() }); }
  const path = rowPathOf(pathname, MIRROR_ROUTE.edit, MIRROR_PATH.edit);
  return path === undefined ? createRefusal("malformed") : forwardBody(request, env, path, MAX_FILE_BYTES);
}
