// Decodes the untrusted JSON bodies the Worker receives, refusing anything but the fields of this major.

import type { ClaimRequest, TicketRequest } from "./httpBodies.js";
import { isRelayToken, isSha256Hex, isShareId, readBody, type BodyReader } from "./bodyFields.js";

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
