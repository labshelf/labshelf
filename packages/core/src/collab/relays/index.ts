/** Exports the relay list of a share and the choice of the one relay its clients use, with failover between them. */
export { addRelay, readShareIndexDocRelays, readRelayList, removeOwnRelay, type RelayEntry } from "./readRelayList.js";
export { FAILURES_BEFORE_HOLD, RELAY_DOWN_HOLD_MS } from "./relayHolds.js";
export { createRelayPresence, type RelayPresence } from "./createRelayPresence.js";
export { PROBE_TIMEOUT_MS, createRelayProbe, type RelayProbeOptions, type RelayVerdict } from "./createRelayProbe.js";
export {
  createRelaySelector, type RelayFailure, type RelaySelector, type RelaySelectorOptions,
} from "./relaySelector.js";
export { createSwitchableTransport, type SwitchableTransport } from "./switchableTransport.js";
export { createRelayWatch, type RelayWatch, type RelayWatchOptions } from "./relayWatch.js";
export { startRelaySelectionFollow, type RelayFollower, type RelayFollowOptions } from "./startRelaySelectionFollow.js";
export { attachRelaySync, SNAPSHOT_AFTER_PUTS } from "./relaySync.js";
export { PUT_INTERVAL_MS } from "./relayDocPuts.js";
export type { RelaySync, RelaySyncOptions } from "./relaySyncOptions.js";
export { createMemoryCursorStore, type RelayCursorStore } from "./relayCursors.js";
