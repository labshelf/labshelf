// Carries a client's relay choice and holds through the presence of a share session and its relay watch, and reads its peers' ones.
import type { Awareness } from "y-protocols/awareness";
import { isPeerPresence, type PresenceStore, type PresenceState, type RelayReport } from "../peer/index.js";
import type { RelayWatch, WatchReports } from "./relayWatch.js";

/** The port the relay selector publishes its report through and reads peers' reports from. */
export interface RelayPresence {
  peers(): RelayReport[];
  publish(report: RelayReport): void;
  onPeersChange(listener: () => void): () => void;
  /** Bridges presence to these other relays while this client is the lowest awareness id on its relay; `reports` hears each watch socket's outcome. */
  watch(relayUrls: readonly string[], reports: WatchReports): void;
}

// TRAP: y-protocols names the origin of a change this device made "local"; reacting to it would re-run selection on every publish.
const LOCAL_ORIGIN = "local";

export const reportOf = (state: PresenceState): RelayReport => ({ relay: state.relay ?? null, relaysDown: state.relaysDown ?? {} });

/** Calls `listener` on every presence change that came from a peer. */
export function onRemoteChange(awareness: Awareness, listener: () => void): () => void {
  const onChange = (_changes: unknown, origin: unknown) => { if (origin !== LOCAL_ORIGIN) { listener(); } };
  awareness.on("change", onChange);
  return () => awareness.off("change", onChange);
}

/** The presence shown on a watched relay: who this is, with no cursor, since the watcher edits nothing there. */
function watchedState(handle: PresenceStore, report: RelayReport): PresenceState | undefined {
  const local: unknown = handle.awareness.getLocalState();
  return isPeerPresence(local) ? { name: local.name, colour: local.colour, file: null, anchor: null, head: null, ...report } : undefined;
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function createRelayPresence(handle: PresenceStore, watch: RelayWatch): RelayPresence {
  return {
    peers: () => [...handle.remote().values()].map(reportOf).concat(watch.reports()),
    publish: (report) => {
      handle.setRelay(report);
      const state = watchedState(handle, report);
      if (state) { watch.publish(state); }
    },
    onPeersChange: (listener) => {
      const stops = [onRemoteChange(handle.awareness, listener), watch.onChange(listener)];
      return () => stops.forEach((stop) => stop());
    },
    watch: (relayUrls, reports) => watch.follow(handle.isLowestId() ? relayUrls : [], reports),
  };
}
