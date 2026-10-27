// Declares the relay's JSON bodies and decodes the untrusted ones, checking the version and the fields before anyone reads them.

import { parseRelayVersion, RELAY_PROTOCOL_MAJOR, RELAY_PROTOCOL_VERSION } from "./protocolVersion.js";

export interface ClaimRequest { v: string; shareId: string; relayTokenHash: string }
export interface TicketRequest { v: string; shareId: string; relayToken: string }

/** `worker` is the Worker build, `<major>.<minor>.<patch>`, whose `major.minor` is `v`. */
export interface VersionResponse { v: string; worker: string }
export interface ClaimResponse { v: string }
/** `expires` is a Unix time in seconds. */
export interface TicketResponse { v: string; ticket: string; expires: number }
/** `error` may be a code of a newer minor, which a client reads as a refusal. */
export interface Refusal { v: string; error: string }

type RelayBody = ClaimRequest | TicketRequest | VersionResponse | ClaimResponse | TicketResponse | Refusal;
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
/** 32 bytes in base64url without padding. */
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
  decodeResponse<VersionResponse>(value, ({ v, worker }) =>
    typeof worker === "string" && new RegExp(`^${String(v).replace(".", "\\.")}\\.(0|[1-9]\\d*)$`).test(worker) ? { worker } : undefined);

export const decodeClaimResponse = (value: unknown): ResponseResult<ClaimResponse> => decodeResponse<ClaimResponse>(value, () => ({}));

export const decodeTicketResponse = (value: unknown): ResponseResult<TicketResponse> =>
  decodeResponse<TicketResponse>(value, ({ ticket, expires }) => (isTicket(ticket) && isUnixTime(expires) ? { ticket, expires } : undefined));

export const decodeRefusal = (value: unknown): ResponseResult<Refusal> =>
  decodeResponse<Refusal>(value, ({ error }) => (typeof error === "string" && error.length > 0 ? { error } : undefined));
