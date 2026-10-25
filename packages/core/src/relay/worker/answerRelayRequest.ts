// Answers the relay's HTTP endpoints and hands authorised socket upgrades to the share's Durable Object.

import { base64UrlToBytes, bytesToBase64Url } from "../../encoding/index.js";
import { RELAY_WORKER_BUILD } from "../protocolVersion.js";
import { decodeClaimRequest, decodeTicketRequest, isShareId, RELAY_PATH } from "../http/index.js";
import type { RelayEnv, CloudflareStubLike } from "./cloudflareRuntime.js";
import { answer, createNotFoundAnswer, createPreflightAnswer, createRefusal } from "./httpAnswers.js";
import { ROOM_PATH } from "./room.js";
import { answerShareRequest } from "./shareRoutes.js";
import { SHARE_PATH } from "../../share/http/index.js";
import { checkOwnerSecret } from "./checkOwner.js";
import { deriveSecretSha256 } from "./hashSecret.js";

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
