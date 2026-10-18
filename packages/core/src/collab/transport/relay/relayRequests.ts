// Calls a relay's JSON endpoints: the owner's claim of a share and a socket ticket.
import { base64UrlToBytes } from "../../../encoding/index.js";
import { sha256Hex } from "../../../hash/index.js";
import {
  decodeClaimResponse, decodeRefusal, decodeTicketResponse, encodeRelayBody, RELAY_PATH,
  type ResponseResult, type TicketResponse,
} from "../../../relay/index.js";
import { RelayRequestError } from "./relayRequestError.js";

export interface ClaimRequestOptions { relayUrl: string; ownerSecret: string; shareId: string; relayToken: string; fetch?: typeof fetch }
export interface TicketRequestOptions { relayUrl: string; shareId: string; relayToken: string; fetch?: typeof fetch }

// CONTRACT: documents/contracts/relay.md#auth
/** Registers the share on the owner's relay; claiming it again with the same token is a no-op. */
export async function claimShare({ relayUrl, ownerSecret, shareId, relayToken, fetch: doFetch = fetch }: ClaimRequestOptions): Promise<void> {
  const relayTokenHash = await sha256Hex(base64UrlToBytes(relayToken));
  await post(doFetch, relayUrl, RELAY_PATH.claim, encodeRelayBody({ shareId, relayTokenHash }), decodeClaimResponse, { authorization: `Bearer ${ownerSecret}` });
}

// CONTRACT: documents/contracts/relay.md#endpoints
export function fetchTicket({ relayUrl, shareId, relayToken, fetch: doFetch = fetch }: TicketRequestOptions): Promise<TicketResponse> {
  return post(doFetch, relayUrl, RELAY_PATH.ticket, encodeRelayBody({ shareId, relayToken }), decodeTicketResponse);
}

async function post<T>(
  doFetch: typeof fetch, relayUrl: string, path: string, body: string, decode: (value: unknown) => ResponseResult<T>, headers: Record<string, string> = {},
): Promise<T> {
  const url = `${relayUrl.replace(/\/+$/, "")}${path}`;
  let response: Response;
  try {
    response = await doFetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  } catch (error) {
    throw new RelayRequestError("network", 0, `${path}: ${String(error)}`);
  }
  // TRAP: a down relay answers with a Cloudflare or proxy HTML page, so a 5xx or a body that is not JSON says the relay is down, not that the network failed.
  if (response.status >= 500) { throw new RelayRequestError("relayDown", response.status, `${path}: HTTP ${response.status}`); }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new RelayRequestError("relayDown", response.status, `${path}: HTTP ${response.status} with a body that is not JSON`);
  }
  const decoded = response.ok ? decode(json) : decodeRefusal(json);
  if (!decoded.ok) {
    const detail = decoded.error === "incompatibleRelay" ? `${path}: the relay speaks ${decoded.worker}` : `${path}: unreadable answer`;
    throw new RelayRequestError(decoded.error, response.status, detail);
  }
  if (!response.ok) { throw new RelayRequestError((decoded.value as { error: string }).error, response.status, `${path} refused`); }
  return decoded.value as T;
}
