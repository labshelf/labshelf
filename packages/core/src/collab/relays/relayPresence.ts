// Carries a client's relay choice and holds through the presence of a share session, and reads its peers' ones.
import type { PresenceHandle, RelayReport } from "../sync/index.js";

/** The port the relay selector publishes its report through and reads peers' reports from. */
export interface RelayPresence {
  peers(): RelayReport[];
  publish(report: RelayReport): void;
  onPeersChange(listener: () => void): () => void;
}

// TRAP: y-protocols names the origin of a change this device made "local"; reacting to it would re-run selection on every publish.
const LOCAL_ORIGIN = "local";

export function relayPresence(handle: PresenceHandle): RelayPresence {
  return {
    peers: () => [...handle.remote().values()].map((state) => ({ relay: state.relay ?? null, relaysDown: state.relaysDown ?? {} })),
    publish: (report) => handle.setRelay(report),
    onPeersChange: (listener) => {
      const onChange = (_changes: unknown, origin: unknown) => { if (origin !== LOCAL_ORIGIN) { listener(); } };
      handle.awareness.on("change", onChange);
      return () => handle.awareness.off("change", onChange);
    },
  };
}
