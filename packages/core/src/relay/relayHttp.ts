// Declares the relay's JSON bodies and decodes the untrusted ones, checking the version and the fields before anyone reads them.

import { bytesToBase64Url } from "../encoding/index.js";
import { parseRelayVersion, RELAY_PROTOCOL_MAJOR, RELAY_PROTOCOL_VERSION } from "./protocolVersion.js";

export interface ClaimRequest { v: string; shareId: string; relayTokenHash: string }
export interface TicketRequest { v: string; shareId: string; relayToken: string }

/** `worker` is the Worker build, `<major>.<minor>.<patch>`, whose `major.minor` is `v`. */
/** `migrationTag` names the last Durable Object migration the Worker has applied. */
export interface VersionResponse { v: string; worker: string; migrationTag?: string }
export interface ClaimResponse { v: string }
/** `expires` is a Unix time in seconds. */
export interface TicketResponse { v: string; ticket: string; expires: number }
/** `error` may be a code of a newer minor, which a client reads as a refusal. */
export interface Refusal { v: string; error: string }

/** The sealed invite envelope as the inbox sees it: only `to` and `expires` are read; the rest is kept as sent. */
export type SealedEnvelope = Record<string, unknown> & { to: string; expires: number };
/** The one body without `v`, since the directory builds it; `ts` and `sig` are the directory's proof of a forward. */
export interface InboxPostRequest { v?: string; sealed: SealedEnvelope; from: string; ts?: number; sig?: string }
export interface InboxPostResponse { v: string; id: string }
/** `received` is epoch ms. */
export interface InboxInvite { id: string; sealed: SealedEnvelope; from: string; received: number }
export interface InboxListResponse { v: string; invites: InboxInvite[] }
export interface InboxDeleteResponse { v: string }

type RelayBody =
  | ClaimRequest | TicketRequest | VersionResponse | ClaimResponse | TicketResponse | Refusal
  | InboxPostResponse | InboxListResponse | InboxDeleteResponse;
type BodyFields = RelayBody extends infer Body ? (Body extends RelayBody ? Omit<Body, "v"> : never) : never;

/** The JSON text of a body, stamped with this side's protocol version. */
export function encodeRelayBody(fields: BodyFields): string {
  return JSON.stringify({ v: RELAY_PROTOCOL_VERSION, ...fields });
}

type Fields = Record<string, unknown>;

/** A decoder copies only the fields it knows, so keys of a newer minor never reach the caller. */
type BodyReader<T> = (body: Fields) => Omit<T, "v"> | undefined;

/** Reads `v`, then the fields; another major is reported apart, since it needs an update and not a fix. */
function readBody<T>(value: unknown, read: BodyReader<T>): { ok: true; value: T } | { ok: false; error: "malformed" } | { ok: false; major: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { return { ok: false, error: "malformed" }; }
  const body = value as Fields;
  const version = typeof body.v === "string" ? parseRelayVersion(body.v) : undefined;
  if (!version) { return { ok: false, error: "malformed" }; }
  if (version.major !== RELAY_PROTOCOL_MAJOR) { return { ok: false, major: body.v as string }; }
  const fields = read(body);
  return fields ? { ok: true, value: { v: body.v, ...fields } as T } : { ok: false, error: "malformed" };
}

export const isShareId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
export const isSha256Hex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
/** 32 bytes in base64url without padding; also the form of an invite id, a SHA-256. */
const isRelayToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const isTicket = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
const isUnixTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export type RequestResult<T> = { ok: true; value: T } | { ok: false; error: "malformed" | "incompatibleVersion" };

function decodeRequest<T>(value: unknown, read: BodyReader<T>): RequestResult<T> {
  const result = readBody(value, read);
  return "major" in result ? { ok: false, error: "incompatibleVersion" } : result;
}

export const decodeClaimRequest = (value: unknown): RequestResult<ClaimRequest> =>
  decodeRequest<ClaimRequest>(value, ({ shareId, relayTokenHash }) =>
    isShareId(shareId) && isSha256Hex(relayTokenHash) ? { shareId, relayTokenHash } : undefined);

export const decodeTicketRequest = (value: unknown): RequestResult<TicketRequest> =>
  decodeRequest<TicketRequest>(value, ({ shareId, relayToken }) =>
    isShareId(shareId) && isRelayToken(relayToken) ? { shareId, relayToken } : undefined);

/** `incompatibleRelay` carries the Worker's version so the message can say which side to update. */
export type ResponseResult<T> =
  | { ok: true; value: T } | { ok: false; error: "malformed" } | { ok: false; error: "incompatibleRelay"; worker: string };

function decodeResponse<T>(value: unknown, read: BodyReader<T>): ResponseResult<T> {
  const result = readBody(value, read);
  return "major" in result ? { ok: false, error: "incompatibleRelay", worker: result.major } : result;
}

export const decodeVersionResponse = (value: unknown): ResponseResult<VersionResponse> =>
  decodeResponse<VersionResponse>(value, ({ v, worker, migrationTag }) => {
    if (typeof worker !== "string" || !new RegExp(`^${String(v).replace(".", "\\.")}\\.(0|[1-9]\\d*)$`).test(worker)) { return undefined; }
    return typeof migrationTag === "string" ? { worker, migrationTag } : { worker };
  });

export const decodeClaimResponse = (value: unknown): ResponseResult<ClaimResponse> => decodeResponse<ClaimResponse>(value, () => ({}));

export const decodeTicketResponse = (value: unknown): ResponseResult<TicketResponse> =>
  decodeResponse<TicketResponse>(value, ({ ticket, expires }) => (isTicket(ticket) && isUnixTime(expires) ? { ticket, expires } : undefined));

export const decodeRefusal = (value: unknown): ResponseResult<Refusal> =>
  decodeResponse<Refusal>(value, ({ error }) => (typeof error === "string" && error.length > 0 ? { error } : undefined));

const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);
/** A fingerprint or another short base64url name. */
const isFingerprint = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const isSealedEnvelope = (value: unknown): value is SealedEnvelope =>
  isObject(value) && isFingerprint(value.to) && typeof value.expires === "number" && Number.isFinite(value.expires);
/** An invite id: a SHA-256 in base64url. */
export const isInviteId = isRelayToken;

// CONTRACT: documents/contracts/relay.md#inbox — `v` may be missing, but one of another major is still refused.
export function decodeInboxPostRequest(value: unknown): RequestResult<InboxPostRequest> {
  if (!isObject(value)) { return { ok: false, error: "malformed" }; }
  if (value.v !== undefined) {
    const version = typeof value.v === "string" ? parseRelayVersion(value.v) : undefined;
    if (!version) { return { ok: false, error: "malformed" }; }
    if (version.major !== RELAY_PROTOCOL_MAJOR) { return { ok: false, error: "incompatibleVersion" }; }
  }
  const { sealed, from, ts, sig } = value;
  if (!isSealedEnvelope(sealed) || !isFingerprint(from)) { return { ok: false, error: "malformed" }; }
  if ((ts !== undefined && !isUnixTime(ts)) || (sig !== undefined && typeof sig !== "string")) { return { ok: false, error: "malformed" }; }
  return {
    ok: true,
    value: { ...(typeof value.v === "string" ? { v: value.v } : {}), sealed, from, ...(ts !== undefined ? { ts } : {}), ...(sig !== undefined ? { sig } : {}) },
  };
}

export const decodeInboxPostResponse = (value: unknown): ResponseResult<InboxPostResponse> =>
  decodeResponse<InboxPostResponse>(value, ({ id }) => (isInviteId(id) ? { id } : undefined));

const readInvite = (value: unknown): InboxInvite | undefined =>
  isObject(value) && isInviteId(value.id) && isSealedEnvelope(value.sealed) && isFingerprint(value.from) && isUnixTime(value.received)
    ? { id: value.id, sealed: value.sealed, from: value.from, received: value.received }
    : undefined;

export const decodeInboxListResponse = (value: unknown): ResponseResult<InboxListResponse> =>
  decodeResponse<InboxListResponse>(value, ({ invites }) => {
    if (!Array.isArray(invites)) { return undefined; }
    const read = invites.map(readInvite);
    return read.every((invite) => invite !== undefined) ? { invites: read as InboxInvite[] } : undefined;
  });

export const decodeInboxDeleteResponse = (value: unknown): ResponseResult<InboxDeleteResponse> =>
  decodeResponse<InboxDeleteResponse>(value, () => ({}));

// CONTRACT: documents/contracts/relay.md#auth
/** The token that lets a sender post to the owner's inbox for one recipient fingerprint; the Worker recomputes it, so it stores none. */
export async function inboxToken(ownerSecret: string, fingerprint: string): Promise<string> {
  const encoder = new TextEncoder();
  const secret = await crypto.subtle.importKey("raw", encoder.encode(ownerSecret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode("inbox-token") },
    secret,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(fingerprint))));
}
