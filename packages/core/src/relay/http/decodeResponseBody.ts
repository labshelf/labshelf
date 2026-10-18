// Decodes the untrusted JSON answers a client receives from a relay, naming a relay of another major.

import type { ClaimResponse, Refusal, TicketResponse, VersionResponse } from "./httpBodies.js";
import { isTicket, isUnixTime, readBody, type BodyReader } from "./bodyFields.js";

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
