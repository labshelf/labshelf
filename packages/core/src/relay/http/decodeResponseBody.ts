// Decodes the untrusted JSON answers a client receives from a relay, naming a relay of another major.

import type { ClaimResponse, IceServer, Refusal, TicketResponse, TurnResponse, VersionResponse } from "./httpBodies.js";
import { isTicket, isUnixTime, readBody, type BodyReader, type Fields } from "./bodyFields.js";

/** `incompatibleRelay` carries the Worker's version so the message can say which side to update. */
export type ResponseResult<T> =
  | { ok: true; value: T } | { ok: false; error: "malformed" } | { ok: false; error: "incompatibleRelay"; worker: string };

const MAX_ICE_SERVERS = 16;

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

export const decodeTurnResponse = (value: unknown): ResponseResult<TurnResponse> =>
  decodeResponse<TurnResponse>(value, ({ iceServers, expires }) => {
    if (!Array.isArray(iceServers) || iceServers.length > MAX_ICE_SERVERS || !isUnixTime(expires)) { return undefined; }
    const servers = iceServers.map(readIceServer);
    return servers.every((server) => server !== undefined) ? { iceServers: servers as IceServer[], expires } : undefined;
  });

export const decodeRefusal = (value: unknown): ResponseResult<Refusal> =>
  decodeResponse<Refusal>(value, ({ error }) => (typeof error === "string" && error.length > 0 ? { error } : undefined));

const isUrl = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function readIceServer(value: unknown): IceServer | undefined {
  if (typeof value !== "object" || value === null) { return undefined; }
  const { urls, username, credential } = value as Fields;
  const urlsOk = isUrl(urls) || (Array.isArray(urls) && urls.length > 0 && urls.length <= MAX_ICE_SERVERS && urls.every(isUrl));
  if (!urlsOk || (username !== undefined && typeof username !== "string") || (credential !== undefined && typeof credential !== "string")) {
    return undefined;
  }
  return { urls: urls as string | string[], ...(username === undefined ? {} : { username }), ...(credential === undefined ? {} : { credential }) };
}
