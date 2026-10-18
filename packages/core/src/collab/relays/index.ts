/** Exports the relay list of a share and the choice of the one relay its clients use, with failover between them. */
export { addRelay, indexRelays, relayList, removeOwnRelay, type RelayEntry } from "./relayList.js";
export { FAILURES_BEFORE_HOLD, RELAY_DOWN_HOLD_MS } from "./relayHolds.js";
export { relayPresence, type RelayPresence } from "./relayPresence.js";
export { PROBE_TIMEOUT_MS, relayProbe, type RelayProbeOptions } from "./relayProbe.js";
export {
  createRelaySelector, RELAY_RETRY_MS, type RelayFailure, type RelaySelector, type RelaySelectorOptions,
} from "./relaySelector.js";
export { createSwitchableTransport, type SwitchableTransport } from "./switchableTransport.js";
export { followRelaySelection, type RelayFollower, type RelayFollowOptions } from "./followRelaySelection.js";
