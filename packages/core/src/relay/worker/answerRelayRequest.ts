// Answers the relay's HTTP endpoints: claims, tickets and share reads and writes in KV, and hands authorised socket upgrades
// to the share's Durable Object.

import { base64UrlToBytes, bytesToBase64Url, bytesToHex } from "../../encoding/index.js";
import { SHARE_PATH, SHARE_REFUSAL } from "../../share/http/index.js";
import { RELAY_WORKER_BUILD } from "../protocolVersion.js";
import { decodeClaimRequest, decodeTicketRequest, encodeRelayBody, isSha256Hex, isShareId } from "../relayHttp.js";
import { RELAY_PATH, RELAY_REFUSAL } from "../relayPaths.js";
import type { CloudflareStubLike, KvNamespace, RelayEnv } from "./cloudflareRuntime.js";
import { ROOM_PATH } from "./room.js";

async function deriveSecretSha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
}

/** Compares equal-length digests, so the time taken says nothing about where the texts differ. */
async function isSecretMatch(given: string, expected: string): Promise<boolean> {
  const encode = (text: string) => new TextEncoder().encode(text);
  const [a, b] = await Promise.all([deriveSecretSha256(encode(given)), deriveSecretSha256(encode(expected))]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) { difference |= a.charCodeAt(index) ^ b.charCodeAt(index); }
  return difference === 0;
}

// CONTRACT: documents/contracts/relay.md#endpoints — any origin, since no cookie is involved.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

type RefusalKind = keyof typeof RELAY_REFUSAL | keyof typeof SHARE_REFUSAL;

const REFUSAL_STATUS: Record<RefusalKind, number> = {
  malformed: 400, incompatibleVersion: 400, unauthorized: 401, forbidden: 403, claimed: 409,
  notFound: 404, tooLarge: 413,
};

type AnswerFields =
  | { worker: string } | Record<string, never> | { ticket: string; expires: number };

function answer(fields: AnswerFields): Response {
  return new Response(encodeRelayBody(fields), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function createRefusal(error: RefusalKind): Response {
  return new Response(encodeRelayBody({ error }), {
    status: REFUSAL_STATUS[error], headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const createPreflightAnswer = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

const createNotFoundAnswer = (): Response => new Response(null, { status: 404, headers: CORS_HEADERS });

const createNoContentAnswer = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

/** Raw stored bytes; the share page reads them cross-origin. */
const createBytesAnswer = (body: ConstructorParameters<typeof Response>[0]): Response =>
  new Response(body, { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/octet-stream" } });

/** A Worker without `OWNER_SECRET` refuses every owner request and logs why. */
async function checkOwnerSecret(request: Request, env: RelayEnv, endpoint: string): Promise<boolean> {
  if (!env.OWNER_SECRET) {
    console.error(`relay ${endpoint}: OWNER_SECRET is not set, refusing every owner request`);
    return false;
  }
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  return bearer !== undefined && isSecretMatch(bearer, env.OWNER_SECRET);
}

// CONTRACT: documents/contracts/share-link.md#worker-endpoints
const KV_VALUE_LIMIT = 25 * 1024 * 1024;

interface Target { shareId: string; key: string; blobHash?: string }

const manifestKey = (shareId: string): string => `share:${shareId}:manifest`;

/** Undefined for a path that is no share endpoint; `"malformed"` for one with a bad id or hash. */
function parseTarget(pathname: string): Target | "malformed" | undefined {
  const [shareId, kind, hash, extra] = pathname.slice(SHARE_PATH.prefix.length).split("/");
  const isManifest = kind === "manifest" && hash === undefined;
  const isBlob = kind === "blob" && hash !== undefined && extra === undefined;
  if (!isManifest && !isBlob) { return undefined; }
  if (!isShareId(shareId) || (isBlob && !isSha256Hex(hash))) { return "malformed"; }
  return isBlob ? { shareId, key: `blob:${hash}`, blobHash: hash } : { shareId, key: manifestKey(shareId) };
}

async function exists(kv: KvNamespace, key: string): Promise<boolean> {
  const stream = await kv.get(key, "stream");
  await stream?.cancel();
  return stream !== null;
}

async function read(env: RelayEnv, target: Target): Promise<Response> {
  // A blob is readable only while its share's manifest exists, so a revoked link reads nothing.
  if (target.blobHash !== undefined && !(await exists(env.KV, manifestKey(target.shareId)))) { return createNotFoundAnswer(); }
  const stream = await env.KV.get(target.key, "stream");
  return stream ? createBytesAnswer(stream) : createNotFoundAnswer();
}

async function write(request: Request, env: RelayEnv, target: Target): Promise<Response> {
  if (Number(request.headers.get("Content-Length")) > KV_VALUE_LIMIT) { return createRefusal("tooLarge"); }
  const body = await request.arrayBuffer();
  if (body.byteLength > KV_VALUE_LIMIT) { return createRefusal("tooLarge"); }
  if (target.blobHash !== undefined && (await deriveSecretSha256(new Uint8Array(body))) !== target.blobHash) { return createRefusal("malformed"); }
  await env.KV.put(target.key, body);
  return createNoContentAnswer();
}

async function answerShareRequest(request: Request, env: RelayEnv, pathname: string): Promise<Response> {
  const target = parseTarget(pathname);
  if (!target) { return createNotFoundAnswer(); }
  if (target === "malformed") { return createRefusal("malformed"); }
  const { method } = request;
  if (method === "GET") { return read(env, target); }
  const isBlob = target.blobHash !== undefined;
  if (method !== "PUT" && method !== "DELETE" && !(method === "HEAD" && isBlob)) { return createNotFoundAnswer(); }
  if (!(await checkOwnerSecret(request, env, "share"))) { return createRefusal("unauthorized"); }
  if (method === "PUT") { return write(request, env, target); }
  if (method === "HEAD") { return (await exists(env.KV, target.key)) ? createBytesAnswer(null) : createNotFoundAnswer(); }
  await env.KV.delete(target.key);
  return createNoContentAnswer();
}

const TICKET_SECONDS = 300;
const TICKET_PATTERN = /^([1-9]\d{0,11})\.([A-Za-z0-9_-]{43})$/;

// CONTRACT: documents/contracts/relay.md#auth
async function ticketKey(ownerSecret: string) {
  const secret = await crypto.subtle.importKey("raw", new TextEncoder().encode(ownerSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("ticket") },
    secret,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

const signedText = (shareId: string, expires: number) => new TextEncoder().encode(`${shareId}|${expires}`);

async function mintTicket(ownerSecret: string, shareId: string, nowSeconds: number): Promise<{ ticket: string; expires: number }> {
  const expires = nowSeconds + TICKET_SECONDS;
  const mac = await crypto.subtle.sign("HMAC", await ticketKey(ownerSecret), signedText(shareId, expires));
  return { ticket: `${expires}.${bytesToBase64Url(new Uint8Array(mac))}`, expires };
}

/** False for a malformed, forged, expired or other share's ticket; HMAC verify compares in constant time. */
async function verifyTicket(ownerSecret: string, shareId: string, ticket: string, nowSeconds: number): Promise<boolean> {
  const match = TICKET_PATTERN.exec(ticket);
  if (!match || Number(match[1]) <= nowSeconds) { return false; }
  let mac: Uint8Array;
  try { mac = base64UrlToBytes(match[2]!); } catch { return false; }
  return crypto.subtle.verify("HMAC", await ticketKey(ownerSecret), mac as Uint8Array<ArrayBuffer>, signedText(shareId, Number(match[1])));
}

const MAX_BODY_CHARS = 4096;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const roomOf = (env: RelayEnv, shareId: string): CloudflareStubLike => env.ROOM.get(env.ROOM.idFromName(shareId));
const askRoom = (env: RelayEnv, shareId: string, path: string, tokenHash: string): Promise<Response> =>
  roomOf(env, shareId).fetch(new Request(`https://room${path}`, { method: "POST", body: tokenHash }));

/** Undefined for a body that is too long or not JSON; the decoders refuse undefined as malformed. */
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) { return undefined; }
  try { return JSON.parse(text); } catch { return undefined; }
}

async function claim(request: Request, env: RelayEnv): Promise<Response> {
  if (!(await checkOwnerSecret(request, env, "claim"))) { return createRefusal("unauthorized"); }
  const body = decodeClaimRequest(await readJson(request));
  if (!body.ok) { return createRefusal(body.error); }
  const room = await askRoom(env, body.value.shareId, ROOM_PATH.claim, body.value.relayTokenHash);
  return room.ok ? answer({}) : createRefusal("claimed");
}

async function ticket(request: Request, env: RelayEnv): Promise<Response> {
  const body = decodeTicketRequest(await readJson(request));
  if (!body.ok) { return createRefusal(body.error); }
  let token: Uint8Array;
  try { token = base64UrlToBytes(body.value.relayToken); } catch { return createRefusal("malformed"); }
  const room = await askRoom(env, body.value.shareId, ROOM_PATH.check, await deriveSecretSha256(token));
  if (!room.ok) { return createRefusal("forbidden"); }
  if (!env.OWNER_SECRET) { console.error("relay ticket: OWNER_SECRET is not set, cannot sign tickets"); return createRefusal("unauthorized"); }
  return answer(await mintTicket(env.OWNER_SECRET, body.value.shareId, nowSeconds()));
}

async function openSocket(request: Request, env: RelayEnv, url: URL): Promise<Response> {
  const shareId = url.pathname.slice(RELAY_PATH.project.length);
  if (!isShareId(shareId)) { return createNotFoundAnswer(); }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") { return new Response(null, { status: 426 }); }
  const given = url.searchParams.get("ticket") ?? "";
  if (!env.OWNER_SECRET || !(await verifyTicket(env.OWNER_SECRET, shareId, given, nowSeconds()))) { return createRefusal("unauthorized"); }
  return roomOf(env, shareId).fetch(request);
}

export async function answerRelayRequest(request: Request, env: RelayEnv): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (request.method === "OPTIONS") { return createPreflightAnswer(); }
  if (route === `GET ${RELAY_PATH.version}`) { return answer({ worker: RELAY_WORKER_BUILD }); }
  if (route === `POST ${RELAY_PATH.claim}`) { return claim(request, env); }
  if (route === `POST ${RELAY_PATH.ticket}`) { return ticket(request, env); }
  if (url.pathname.startsWith(SHARE_PATH.prefix)) { return answerShareRequest(request, env, url.pathname); }
  if (request.method === "GET" && url.pathname.startsWith(RELAY_PATH.project)) { return openSocket(request, env, url); }
  return createNotFoundAnswer();
}
