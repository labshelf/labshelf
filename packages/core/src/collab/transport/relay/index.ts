/** Exports the relay transport, its claim, ticket and TURN requests, and the merge of a relay with a direct transport. */
export {
  createRelayTransport, RECONNECT_FIRST_MS, RECONNECT_MAX_MS, RELAY_AWARENESS_INTERVAL_MS,
  type RelayStore, type RelayStoreAnswer, type RelayStoreRequest, type RelayTransport, type RelayTransportOptions,
} from "./relayTransport.js";
export {
  claimShare, fetchTicket, fetchTurnServers, type ClaimRequestOptions, type TicketRequestOptions, type TurnRequestOptions,
} from "./relayRequests.js";
export { RelayRequestError } from "./relayRequestError.js";
export { mergeTransports } from "./mergeTransports.js";
export { globalSocketFactory, type RelaySocket, type RelaySocketFactory } from "./relaySocket.js";
