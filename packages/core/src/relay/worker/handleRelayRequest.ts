// Answers the relay's HTTP endpoints and hands authorised socket upgrades to the share's Durable Object.

import { base64UrlToBytes } from "../../encoding/index.js";
import { RELAY_WORKER_BUILD } from "../protocolVersion.js";
import { decodeClaimRequest, decodeTicketRequest, decodeTurnRequest, isShareId, RELAY_PATH } from "../http/index.js";
import type { RelayEnv, RoomStub } from "./cloudflareRuntime.js";
import { answer, notFound, preflight, refuse } from "./httpAnswers.js";
import { ROOM_PATH } from "./room.js";
import { secretsMatch, sha256Hex } from "./secretDigest.js";
import { mintTicket, verifyTicket } from "./ticket.js";
import { mintIceServers } from "./turnCredentials.js";

const MAX_BODY_CHARS = 4096;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);
const roomOf = (env: RelayEnv, shareId: string): RoomStub => env.ROOM.get(env.ROOM.idFromName(shareId));
const askRoom = (env: RelayEnv, shareId: string, path: string, tokenHash: string): Promise<Response> =>
  roomOf(env, shareId).fetch(new Request(`https://room${path}`, { method: "POST", body: tokenHash }));

/** Undefined for a body that is too long or not JSON; the decoders refuse undefined as malformed. */
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) { return undefined; }
  try { return JSON.parse(text); } catch { return undefined; }
}

async function claim(request: Request, env: RelayEnv): Promise<Response> {
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!env.OWNER_SECRET) { console.error("relay claim: OWNER_SECRET is not set, refusing every claim"); }
  if (!env.OWNER_SECRET || bearer === undefined || !(await secretsMatch(bearer, env.OWNER_SECRET))) { return refuse("unauthorized"); }
  const body = decodeClaimRequest(await readJson(request));
  if (!body.ok) { return refuse(body.error); }
  const room = await askRoom(env, body.value.shareId, ROOM_PATH.claim, body.value.relayTokenHash);
  return room.ok ? answer({}) : refuse("claimed");
}

async function ticket(request: Request, env: RelayEnv): Promise<Response> {
  const body = decodeTicketRequest(await readJson(request));
  if (!body.ok) { return refuse(body.error); }
  let token: Uint8Array;
  try { token = base64UrlToBytes(body.value.relayToken); } catch { return refuse("malformed"); }
  const room = await askRoom(env, body.value.shareId, ROOM_PATH.check, await sha256Hex(token));
  if (!room.ok) { return refuse("forbidden"); }
  if (!env.OWNER_SECRET) { console.error("relay ticket: OWNER_SECRET is not set, cannot sign tickets"); return refuse("unauthorized"); }
  return answer(await mintTicket(env.OWNER_SECRET, body.value.shareId, nowSeconds()));
}

async function turn(request: Request, env: RelayEnv): Promise<Response> {
  const body = decodeTurnRequest(await readJson(request));
  if (!body.ok) { return refuse(body.error); }
  if (!env.OWNER_SECRET || !(await verifyTicket(env.OWNER_SECRET, body.value.shareId, body.value.ticket, nowSeconds()))) {
    return refuse("unauthorized");
  }
  const minted = await mintIceServers(env, nowSeconds());
  return minted.ok ? answer({ iceServers: minted.iceServers, expires: minted.expires }) : refuse(minted.error);
}

async function openSocket(request: Request, env: RelayEnv, url: URL): Promise<Response> {
  const shareId = url.pathname.slice(RELAY_PATH.project.length);
  if (!isShareId(shareId)) { return notFound(); }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") { return new Response(null, { status: 426 }); }
  const given = url.searchParams.get("ticket") ?? "";
  if (!env.OWNER_SECRET || !(await verifyTicket(env.OWNER_SECRET, shareId, given, nowSeconds()))) { return refuse("unauthorized"); }
  return roomOf(env, shareId).fetch(request);
}

export async function handleRelayRequest(request: Request, env: RelayEnv): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${url.pathname}`;
  if (request.method === "OPTIONS") { return preflight(); }
  if (route === `GET ${RELAY_PATH.version}`) { return answer({ worker: RELAY_WORKER_BUILD }); }
  if (route === `POST ${RELAY_PATH.claim}`) { return claim(request, env); }
  if (route === `POST ${RELAY_PATH.ticket}`) { return ticket(request, env); }
  if (route === `POST ${RELAY_PATH.turn}`) { return turn(request, env); }
  if (request.method === "GET" && url.pathname.startsWith(RELAY_PATH.project)) { return openSocket(request, env, url); }
  return notFound();
}
