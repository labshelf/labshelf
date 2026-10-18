// Shares the local user's presence with the peers of a session and tracks theirs, never persisting any of it.
import * as Y from "yjs";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { ILogger } from "../../../ports/index.js";
import type { WebCryptoKey } from "../../crypto/index.js";
import type { PeerId } from "../../transport/index.js";
import type { Channel } from "../mesh/index.js";
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

/** The part of a share session presence travels over; a bare secure mesh has it too. */
export type AwarenessLinks = Pick<ShareSession, "channel" | "onPeer">;

export interface PresenceHandle {
  /** The y-protocols awareness an editor cursor extension binds to; its remote states are unchecked, unlike `remote()`. */
  readonly awareness: Awareness;
  setLocal(state: PresenceState): void;
  /** Publishes the relay this user is on with every later presence; it waits for a presence when none is set yet. */
  setRelay(report: RelayReport): void;
  /** The presence of the other peers, by awareness client id, without any state that has the wrong shape. */
  remote(): Map<number, PresenceState>;
  /** True when no peer on this client's relay has a lower awareness id; peers drop out when they leave. */
  isLowestId(): boolean;
  /** True when this peer reports another relay than this client's: a watcher bridging presence, which holds no doc or blob. */
  reportsOtherRelay(peer: PeerId): boolean;
  /** Tells the peers this user left, then stops. */
  close(): Promise<void>;
}

interface FromPeer { peer: PeerId }
const isFromPeer = (origin: unknown): origin is FromPeer => typeof origin === "object" && origin !== null && "peer" in origin;

interface AwarenessChange { added: number[]; updated: number[]; removed: number[] }

function rememberReported(reported: Map<PeerId, Set<number>>, peer: PeerId, { added, updated, removed }: AwarenessChange): void {
  const ids = reported.get(peer) ?? new Set<number>();
  [...added, ...updated].forEach((id) => ids.add(id));
  removed.forEach((id) => ids.delete(id));
  reported.set(peer, ids);
}

function forgetPeer(awareness: Awareness, reported: Map<PeerId, Set<number>>, peer: PeerId): void {
  const ids = [...(reported.get(peer) ?? [])].filter((id) => id !== awareness.clientID && awareness.states.has(id));
  reported.delete(peer);
  removeAwarenessStates(awareness, ids, "peer-left");
  // TRAP: removing a state bumps its stored clock past the peer's own, so the peer's state would be dropped as stale when it returns.
  ids.forEach((id) => awareness.meta.delete(id));
}

function wellFormedRemote(awareness: Awareness): Map<number, PresenceState> {
  const states = new Map<number, PresenceState>();
  awareness.getStates().forEach((state, id) => { if (id !== awareness.clientID && isPresenceState(state)) { states.set(id, state); } });
  return states;
}

/** A peer that reports another relay is a watcher bridging presence from there, not a member of this relay's group. */
function onOtherRelay(state: unknown, relay: RelayReport | undefined): boolean {
  const theirs = (state as { relay?: unknown } | null)?.relay;
  return typeof theirs === "string" && typeof relay?.relay === "string" && theirs !== relay.relay;
}

function openChannel(session: AwarenessLinks, options: AwarenessOptions, awareness: Awareness, isClosed: () => boolean): Channel {
  return session.channel({
    kind: CHANNEL_KIND.awareness,
    name: "awareness",
    key: options.awarenessKey,
    reliable: false,
    onMessage: (from, _docKey, payload) => {
      if (isClosed()) { return; }
      try {
        applyAwarenessUpdate(awareness, payload, { peer: from });
      } catch (error) {
        void options.logger.log("WARN", LOG_MODULE, "Dropped an awareness update that could not be read", { peer: from, error: String(error) });
      }
    },
  });
}

/** Collects the sends in flight so a close can wait for the last presence to leave. */
function sendTracker() {
  const inFlight = new Set<Promise<void>>();
  return {
    track(promise: Promise<void>): void {
      inFlight.add(promise);
      void promise.finally(() => inFlight.delete(promise));
    },
    settled: () => Promise.all(inFlight),
  };
}

export function attachAwareness(session: AwarenessLinks, options: AwarenessOptions): PresenceHandle {
  const awareness = new Awareness(new Y.Doc());
  // No presence is announced until the editor sets one.
  awareness.setLocalState(null);
  const reported = new Map<PeerId, Set<number>>();
  const { track, settled } = sendTracker();
  let closed = false;
  let relay: RelayReport | undefined;
  const channel = openChannel(session, options, awareness, () => closed);

  awareness.on("update", (change: AwarenessChange, origin: unknown) => {
    if (origin === LOCAL_ORIGIN) {
      track(channel.send("all", AWARENESS_DOC_KEY, encodeAwarenessUpdate(awareness, [...change.added, ...change.updated, ...change.removed])));
    } else if (isFromPeer(origin)) {
      rememberReported(reported, origin.peer, change);
    }
  });

  const stopPeers = session.onPeer((peer, joined) => {
    if (closed) { return; }
    if (!joined) { forgetPeer(awareness, reported, peer); }
    else if (awareness.getLocalState() !== null) {
      track(channel.send(peer, AWARENESS_DOC_KEY, encodeAwarenessUpdate(awareness, [awareness.clientID])));
    }
  });

  return {
    awareness,
    setLocal: (state) => awareness.setLocalState({ ...state, ...relay }),
    setRelay: (report) => {
      relay = { relay: report.relay, relaysDown: { ...report.relaysDown } };
      const current = awareness.getLocalState();
      if (current !== null) { awareness.setLocalState({ ...current, ...relay }); }
    },
    remote: () => wellFormedRemote(awareness),
    isLowestId: () => [...awareness.getStates()].every(([id, state]) => id >= awareness.clientID || onOtherRelay(state, relay)),
    reportsOtherRelay: (peer) => [...(reported.get(peer) ?? [])].some((id) => onOtherRelay(awareness.states.get(id), relay)),
    close: async () => {
      if (closed) { return; }
      awareness.setLocalState(null);
      await settled();
      closed = true;
      stopPeers();
      // PLATFORM: y-protocols runs a real interval that keeps a process alive until the awareness is destroyed.
      awareness.destroy();
    },
  };
}
