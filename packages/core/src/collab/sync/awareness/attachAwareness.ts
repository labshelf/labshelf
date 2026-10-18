// Shares the local user's presence with the peers of a session and tracks theirs, never persisting any of it.
import * as Y from "yjs";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { ILogger } from "../../../ports/index.js";
import type { WebCryptoKey } from "../../crypto/index.js";
import type { PeerId } from "../../transport/index.js";
import type { ShareSession } from "../shareSession.js";
import { CHANNEL_KIND } from "../wire/index.js";
import { isPresenceState, type PresenceState, type RelayReport } from "./presence.js";

const LOG_MODULE = "collab.awareness";
// The leading slash cannot start a relative path, so it never names a file doc.
const AWARENESS_DOC_KEY = "/awareness";
const LOCAL_ORIGIN = "local";

export interface AwarenessOptions {
  awarenessKey: WebCryptoKey;
  logger: ILogger;
}

export interface PresenceHandle {
  /** The y-protocols awareness an editor cursor extension binds to; its remote states are unchecked, unlike `remote()`. */
  readonly awareness: Awareness;
  setLocal(state: PresenceState): void;
  /** Publishes the relay this user is on with every later presence; it waits for a presence when none is set yet. */
  setRelay(report: RelayReport): void;
  /** The presence of the other peers, by awareness client id, without any state that has the wrong shape. */
  remote(): Map<number, PresenceState>;
  /** Tells the peers this user left, then stops. */
  close(): Promise<void>;
}

interface FromPeer { peer: PeerId }
const isFromPeer = (origin: unknown): origin is FromPeer => typeof origin === "object" && origin !== null && "peer" in origin;

export function attachAwareness(session: ShareSession, options: AwarenessOptions): PresenceHandle {
  const { logger } = options;
  const awareness = new Awareness(new Y.Doc());
  // No presence is announced until the editor sets one.
  awareness.setLocalState(null);
  const reported = new Map<PeerId, Set<number>>();
  const inFlight = new Set<Promise<void>>();
  let closed = false;
  let relay: RelayReport | undefined;

  const channel = session.channel({
    kind: CHANNEL_KIND.awareness,
    name: "awareness",
    key: options.awarenessKey,
    reliable: false,
    onMessage: (from, _docKey, payload) => {
      if (closed) { return; }
      try {
        applyAwarenessUpdate(awareness, payload, { peer: from });
      } catch (error) {
        void logger.log("WARN", LOG_MODULE, "Dropped an awareness update that could not be read", { peer: from, error: String(error) });
      }
    },
  });

  const track = (promise: Promise<void>) => {
    inFlight.add(promise);
    void promise.finally(() => inFlight.delete(promise));
  };

  awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) {
      track(channel.send("all", AWARENESS_DOC_KEY, encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed])));
    } else if (isFromPeer(origin)) {
      const ids = reported.get(origin.peer) ?? new Set<number>();
      [...added, ...updated].forEach((id) => ids.add(id));
      removed.forEach((id) => ids.delete(id));
      reported.set(origin.peer, ids);
    }
  });

  const stopPeers = session.onPeer((peer, joined) => {
    if (closed) { return; }
    if (joined) {
      if (awareness.getLocalState() !== null) {
        track(channel.send(peer, AWARENESS_DOC_KEY, encodeAwarenessUpdate(awareness, [awareness.clientID])));
      }
      return;
    }
    const ids = [...(reported.get(peer) ?? [])].filter((id) => id !== awareness.clientID && awareness.states.has(id));
    reported.delete(peer);
    removeAwarenessStates(awareness, ids, "peer-left");
    // TRAP: removing a state bumps its stored clock past the peer's own, so the peer's state would be dropped as stale when it returns.
    ids.forEach((id) => awareness.meta.delete(id));
  });

  return {
    awareness,
    setLocal: (state) => awareness.setLocalState({ ...state, ...relay }),
    setRelay: (report) => {
      relay = { relay: report.relay, relaysDown: { ...report.relaysDown } };
      const current = awareness.getLocalState();
      if (current !== null) { awareness.setLocalState({ ...current, ...relay }); }
    },
    remote: () => {
      const states = new Map<number, PresenceState>();
      awareness.getStates().forEach((state, id) => { if (id !== awareness.clientID && isPresenceState(state)) { states.set(id, state); } });
      return states;
    },
    close: async () => {
      if (closed) { return; }
      awareness.setLocalState(null);
      await Promise.all(inFlight);
      closed = true;
      stopPeers();
      // PLATFORM: y-protocols runs a real interval that keeps a process alive until the awareness is destroyed.
      awareness.destroy();
    },
  };
}
