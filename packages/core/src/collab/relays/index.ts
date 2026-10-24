/** Exports the relay list of a share and the choice of the one relay its clients use, with failover between them. */
export { addRelay, indexRelays, relayList, removeOwnRelay, type RelayEntry } from "./relayList.js";
export { FAILURES_BEFORE_HOLD, RELAY_DOWN_HOLD_MS } from "./relayHolds.js";
export { relayPresence, type RelayPresence } from "./relayPresence.js";
export { PROBE_TIMEOUT_MS, relayProbe, type RelayProbeOptions, type RelayVerdict } from "./relayProbe.js";
export {
  createRelaySelector, type RelayFailure, type RelaySelector, type RelaySelectorOptions,
} from "./relaySelector.js";
export { createSwitchableTransport, type SwitchableTransport } from "./switchableTransport.js";
export { createRelayWatch, type RelayWatch, type RelayWatchOptions } from "./relayWatch.js";
export { followRelaySelection, type RelayFollower, type RelayFollowOptions } from "./followRelaySelection.js";
export { attachRelaySync, SNAPSHOT_AFTER_PUTS } from "./relaySync.js";
export { PUT_INTERVAL_MS } from "./relayDocPuts.js";
export type { RelaySync, RelaySyncOptions } from "./relaySyncOptions.js";
export { memoryCursorStore, type RelayCursorStore } from "./relayCursors.js";
