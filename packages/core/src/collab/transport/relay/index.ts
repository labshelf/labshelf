/** Exports the relay transport and its claim and ticket requests. */
export {
  createRelayTransport, RECONNECT_FIRST_MS, RECONNECT_MAX_MS, RELAY_AWARENESS_INTERVAL_MS,
  type RelayStore, type RelayStoreAnswer, type RelayStoreRequest, type RelayTransport, type RelayTransportOptions,
} from "./relayTransport.js";
export {
  claimShare, fetchTicket, type ClaimRequestOptions, type TicketRequestOptions,
} from "./relayRequests.js";
export { RelayRequestError } from "./relayRequestError.js";
export { globalSocketFactory, type RelaySocket, type RelaySocketFactory } from "./relayConnection.js";
