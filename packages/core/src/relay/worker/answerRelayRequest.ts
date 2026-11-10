// Answers the relay Worker's HTTP endpoints (claims, tickets, the inbox and, through mirrorRoutes, the remote library, and hands authorised socket upgrades to the share's
// Durable Object) and, for the separate share Worker, the share reads and writes in KV.

import { decodePublicKey } from "../../collab/index.js";
import { base64UrlToBytes } from "../../encoding/index.js";
import { RELAY_WORKER_BUILD } from "../protocolVersion.js";
import {
  decodeClaimRequest, decodeInboxPostRequest, decodeTicketRequest, encodeRelayBody, inboxToken, isInviteId, isSha256Hex, isShareId,
  type InboxInvite, type InboxPostRequest,
} from "../relayHttp.js";
import { lastMigrationTag, RELAY_MIGRATIONS, RELAY_PATH, SHARE_PATH } from "../relayPaths.js";
import type { CloudflareStubLike, KvNamespace, RelayEnv, ShareEnv } from "./cloudflareRuntime.js";
import { canonicalSealed, deriveInviteId, INBOX_PATH, type InboxPostOutcome } from "./inbox.js";
import { answerMirrorRequest } from "./mirrorRoutes.js";
import {
  bearerOf, checkOwnerSecret, CORS_HEADERS, createBytesAnswer, createNotFoundAnswer, createPreflightAnswer, createRefusal, deriveSecretSha256, isSecretMatch,
  signWithOwnerSecret, verifyOwnerSecretMac,
} from "./relayAnswers.js";
import { ROOM_PATH } from "./room.js";

type AnswerFields =
  | { worker: string; migrationTag?: string | undefined } | Record<string, never> | { ticket: string; expires: number }
  | { id: string } | { invites: InboxInvite[] };

function answer(fields: AnswerFields): Response {
  return new Response(encodeRelayBody(fields), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const createNoContentAnswer = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

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

async function read(env: ShareEnv, target: Target): Promise<Response> {
  // A blob is readable only while its share's manifest exists, so a revoked link reads nothing.
  if (target.blobHash !== undefined && !(await exists(env.KV, manifestKey(target.shareId)))) { return createNotFoundAnswer(); }
  const stream = await env.KV.get(target.key, "stream");
  return stream ? createBytesAnswer(stream) : createNotFoundAnswer();
}

async function write(request: Request, env: ShareEnv, target: Target): Promise<Response> {
  if (Number(request.headers.get("Content-Length")) > KV_VALUE_LIMIT) { return createRefusal("tooLarge"); }
  const body = await request.arrayBuffer();
  if (body.byteLength > KV_VALUE_LIMIT) { return createRefusal("tooLarge"); }
  if (target.blobHash !== undefined && (await deriveSecretSha256(new Uint8Array(body))) !== target.blobHash) { return createRefusal("malformed"); }
  await env.KV.put(target.key, body);
  return createNoContentAnswer();
}

// CONTRACT: documents/contracts/share-link.md#worker-endpoints — the share Worker answers only these; the relay Worker none of them.
/** The share Worker's handler: `/share/*` reads and owner writes, CORS preflights, and 404 for everything else. */
export async function answerShareRequest(request: Request, env: ShareEnv): Promise<Response> {
  if (request.method === "OPTIONS") { return createPreflightAnswer(); }
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(SHARE_PATH.prefix)) { return createNotFoundAnswer(); }
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

const signedText = (shareId: string, expires: number) => `${shareId}|${expires}`;

async function mintTicket(ownerSecret: string, shareId: string, nowSeconds: number): Promise<{ ticket: string; expires: number }> {
  const expires = nowSeconds + TICKET_SECONDS;
  return { ticket: `${expires}.${await signWithOwnerSecret(ownerSecret, "ticket", signedText(shareId, expires))}`, expires };
}

/** False for a malformed, forged, expired or other share's ticket. */
async function verifyTicket(ownerSecret: string, shareId: string, ticket: string, nowSeconds: number): Promise<boolean> {
  const match = TICKET_PATTERN.exec(ticket);
  if (!match || Number(match[1]) <= nowSeconds) { return false; }
  return verifyOwnerSecretMac(ownerSecret, "ticket", signedText(shareId, Number(match[1])), match[2]!);
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

// CONTRACT: documents/contracts/relay.md#auth — the deployed directory's ECDSA P-256 key, raw uncompressed, base64url.
const DIRECTORY_PUBLIC_KEY = "BMmUprgH9ehXtuPRb-e5VmBOSqUfecllJZQRTBs1joI3LCnUMoI5wWlr_1V8_rQN879xBSyRksHciDGokUCd0hQ";
const FORWARD_LABEL = "labshelf-directory-forward-v1";
const FORWARD_WINDOW_MS = 10 * 60 * 1000;
/** Room for a 16 KiB invite and its proof; the inbox checks the invite's own size. */
const MAX_INBOX_BODY_CHARS = 64 * 1024;
const ECDSA_P256 = { name: "ECDSA", namedCurve: "P-256" } as const;

const inboxOf = (env: RelayEnv): CloudflareStubLike => env.INBOX.get(env.INBOX.idFromName("inbox"));

/** True for a bearer that is the inbox token of `to`; compared in constant time. */
async function isInboxTokenOf(env: RelayEnv, bearer: string, to: string): Promise<boolean> {
  if (!env.OWNER_SECRET) { console.error("relay inbox: OWNER_SECRET is not set, refusing every inbox token"); return false; }
  return isSecretMatch(bearer, await inboxToken(env.OWNER_SECRET, to));
}

// CONTRACT: documents/contracts/directory.md#forward
/** True when `sig` is the directory's signature of this forward and `ts` is within 10 minutes of now; never throws. */
async function isDirectoryForward(body: InboxPostRequest, sealedText: string, publicKey: string): Promise<boolean> {
  if (body.sig === undefined || body.ts === undefined || Math.abs(Date.now() - body.ts) > FORWARD_WINDOW_MS) { return false; }
  const raw = decodePublicKey(publicKey);
  if (!raw) { console.error("relay inbox: the directory public key is not a P-256 key"); return false; }
  let sig: Uint8Array;
  try { sig = base64UrlToBytes(body.sig); } catch { return false; }
  if (sig.length !== 64) { return false; }
  try {
    const key = await crypto.subtle.importKey("raw", raw, ECDSA_P256, false, ["verify"]);
    const message = `${FORWARD_LABEL}\n${body.sealed.to}\n${await deriveInviteId(sealedText)}\n${body.ts}`;
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig as Uint8Array<ArrayBuffer>, new TextEncoder().encode(message));
  } catch {
    return false;
  }
}

// CONTRACT: documents/contracts/relay.md#inbox — a post without a proof is refused here, so it never reaches the Durable Object.
async function postInbox(request: Request, env: RelayEnv, directoryPublicKey: string): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_INBOX_BODY_CHARS) { return createRefusal("tooLarge"); }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return createRefusal("malformed"); }
  const body = decodeInboxPostRequest(value);
  if (!body.ok) { return createRefusal(body.error); }
  const { sealed, from } = body.value;
  const bearer = bearerOf(request);
  // A bearer that is not the token of sealed.to is refused even with a valid signature.
  const proven = bearer !== undefined
    ? await isInboxTokenOf(env, bearer, sealed.to)
    : await isDirectoryForward(body.value, canonicalSealed(sealed), directoryPublicKey);
  if (!proven) { return createRefusal("unauthorized"); }
  const stored = await inboxOf(env).fetch(new Request(`https://inbox${INBOX_PATH.post}`, { method: "POST", body: JSON.stringify({ sealed, from }) }));
  const outcome = (await stored.json()) as InboxPostOutcome;
  return "id" in outcome ? answer({ id: outcome.id }) : createRefusal(outcome.error);
}

async function listInbox(request: Request, env: RelayEnv): Promise<Response> {
  if (!(await checkOwnerSecret(request, env, "inbox"))) { return createRefusal("unauthorized"); }
  const listed = await inboxOf(env).fetch(new Request(`https://inbox${INBOX_PATH.list}`));
  return answer({ invites: (await listed.json()) as InboxInvite[] });
}

async function deleteInvite(request: Request, env: RelayEnv, id: string): Promise<Response> {
  if (!(await checkOwnerSecret(request, env, "inbox"))) { return createRefusal("unauthorized"); }
  if (!isInviteId(id)) { return createRefusal("malformed"); }
  await inboxOf(env).fetch(new Request(`https://inbox${INBOX_PATH.delete}`, { method: "POST", body: id }));
  return answer({});
}

/** `directoryPublicKey` replaces the built-in directory key, for tests that sign forwards with their own key. */
export interface RelayRequestOptions { directoryPublicKey?: string }

/** The relay Worker's handler; `/share/*` reads 404, since the share Worker serves it. */
export async function answerRelayRequest(request: Request, env: RelayEnv, options: RelayRequestOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (request.method === "OPTIONS") { return createPreflightAnswer(); }
  const mirrored = await answerMirrorRequest(request, env, { fetch: (input, init) => fetch(input, init), now: () => Date.now() });
  if (mirrored) { return mirrored; }
  // CONTRACT: documents/contracts/relay.md#versions
  if (route === `GET ${RELAY_PATH.version}`) { return answer({ worker: RELAY_WORKER_BUILD, migrationTag: lastMigrationTag(RELAY_MIGRATIONS) }); }
  if (route === `POST ${RELAY_PATH.claim}`) { return claim(request, env); }
  if (route === `POST ${RELAY_PATH.ticket}`) { return ticket(request, env); }
  if (route === `POST ${RELAY_PATH.inbox}`) { return postInbox(request, env, options.directoryPublicKey ?? DIRECTORY_PUBLIC_KEY); }
  if (route === `GET ${RELAY_PATH.inbox}`) { return listInbox(request, env); }
  if (request.method === "DELETE" && url.pathname.startsWith(RELAY_PATH.inboxItem)) {
    return deleteInvite(request, env, url.pathname.slice(RELAY_PATH.inboxItem.length));
  }
  if (request.method === "GET" && url.pathname.startsWith(RELAY_PATH.project)) { return openSocket(request, env, url); }
  return createNotFoundAnswer();
}
