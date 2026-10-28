/** Exports the relay list of a share, the choice of the one relay its clients use with failover between them, and the transport shares sync over. */
export { addRelay, readShareIndexDocRelays, readRelayList, removeOwnRelay, type RelayEntry } from "./relayList.js";
export { FAILURES_BEFORE_HOLD, RELAY_DOWN_HOLD_MS, createRelayPresence, type RelayPresence } from "./relayPresence.js";
export {
  PROBE_TIMEOUT_MS, createRelayProbe, createRelayWatch,
  type RelayProbeOptions, type RelayVerdict, type RelayWatch, type RelayWatchOptions,
} from "./relayWatch.js";
export {
  createRelaySelector, startRelaySelectionFollow,
  type RelayFailure, type RelayFollower, type RelayFollowOptions, type RelaySelector, type RelaySelectorOptions,
} from "./relaySelector.js";
export { attachRelaySync, SNAPSHOT_AFTER_PUTS, type RelaySync, type RelaySyncOptions } from "./relaySync.js";
export { PUT_INTERVAL_MS, createMemoryCursorStore, type RelayCursorStore } from "./relayDocLane.js";
export {
  addRelayShare, createGlobalRelayConnection, createRelayTransport, createSwitchableTransport, fetchTicket,
  RECONNECT_FIRST_MS, RECONNECT_MAX_MS, RELAY_AWARENESS_INTERVAL_MS, RelayRequestError,
  type ClaimRequestOptions, type RelayConnectionPort, type RelayConnectionPortFactory,
  type RelayStore, type RelayStoreAnswer, type RelayStoreRequest, type RelayTransport, type RelayTransportOptions,
  type SwitchableTransport, type TicketRequestOptions,
} from "./relayTransport.js";
