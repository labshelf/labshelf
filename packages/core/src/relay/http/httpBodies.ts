// Declares the relay endpoints, the JSON bodies they take and answer, and how a client or the Worker writes one.

import { RELAY_PROTOCOL_VERSION } from "../protocolVersion.js";

// CONTRACT: documents/contracts/relay.md#endpoints
export const RELAY_PATH = { version: "/version", claim: "/claim", ticket: "/ticket", project: "/project/" } as const;

export const RELAY_REFUSAL = {
  malformed: "malformed", incompatibleVersion: "incompatibleVersion", unauthorized: "unauthorized", forbidden: "forbidden", claimed: "claimed",
} as const;

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
