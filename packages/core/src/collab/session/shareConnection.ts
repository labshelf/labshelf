// Connects this device to one shared project: stored state, the peer session over its relays, presence, blobs and the disk mirror.
// CONTRACT: documents/contracts/collaboration.md#connection-lifecycle
import type { ILogger } from "../../ports/index.js";
import { peerColour } from "../binding/index.js";
import { deriveAwarenessKey, deriveContentKey, deriveRelayToken } from "../crypto/index.js";
import type { InviteRelay } from "../invite/index.js";
import { createSwitchableTransport } from "../relays/index.js";
import { openCollabStore, type CollabStateStorage, type CollabStore } from "../state/index.js";
import {
  attachAwareness, attachBlobs, createShareSession, type BlobExchange, type PresenceHandle, type SessionStatus, type ShareSession,
} from "../sync/index.js";
import type { ConnectionMirror, MirrorFactory, MirrorStart, MirrorState } from "./connectionMirror.js";
import { placeSharedProject, type ShareProjects, type ShareStart } from "./placeSharedProject.js";
import { followShareRelays, type RelayNetwork, type ShareRelays } from "./shareRelays.js";
import { watchStorageHealth, type StorageHealth } from "./storageHealth.js";

const LOG_MODULE = "collab.connection";

export interface ShareConnectionState {
  readonly status: SessionStatus;
  /** The relay in use; undefined while none of the share's relays is usable. */
  readonly relay: string | undefined;
  /** Why this device cannot store the share's state; edits then live in memory and with peers only. */
  readonly persistenceFailure: string | undefined;
  readonly mirror: MirrorState;
}

export interface ShareConnection {
  readonly shareId: string;
  readonly shareKey: Uint8Array;
  readonly folder: string;
  /** The id of the project a join created; undefined for share and resume. */
  readonly joinedId: string | undefined;
  readonly session: ShareSession;
  readonly presence: PresenceHandle;
  readonly relays: ShareRelays;
  /** The running mirror; undefined while another mirror owns the folder. */
  readonly mirror: ConnectionMirror | undefined;
  state(): ShareConnectionState;
  onStateChange(listener: () => void): () => void;
  /** Closes in order and stores every pending update; rejects when state stays unstored. Later calls return the same promise. */
  close(): Promise<void>;
}

export interface ShareConnectionOptions {
  shareId: string;
  shareKey: Uint8Array;
  /** The invite's relays, tried while the index lists none. */
  relays: readonly InviteRelay[];
  /** This device's state of the share; the connection opens the store on it and closes it. */
  storage: CollabStateStorage;
  projects: ShareProjects;
  startMirror: MirrorFactory;
  /** This user's name in the presence peers see. */
  name: string;
  logger: ILogger;
  network?: RelayNetwork;
}

/** What has started so far, closed in the order the parts depend on each other. */
interface Parts {
  store?: CollabStore;
  session?: ShareSession;
  presence?: PresenceHandle;
  relays?: ShareRelays;
  blobs?: BlobExchange;
  mirror?: ConnectionMirror;
}

/** Closes every part even after one fails; logs each failure and rejects with the first. */
async function closeParts(parts: Parts, logger: ILogger, shareId: string): Promise<void> {
  const steps: [string, (() => unknown) | undefined][] = [
    ["presence", parts.presence && (() => parts.presence?.close())],
    // The mirror waits for blob fetches in flight, so the exchange closes first.
    ["blob exchange", parts.blobs && (() => parts.blobs?.close())],
    ["mirror", parts.mirror && (() => parts.mirror?.close())],
    // The relay sync puts its last updates over the relay socket before the session closes.
    ["relays", parts.relays && (() => parts.relays?.close())],
    ["session", parts.session && (() => parts.session?.close())],
    ["share state", parts.store && (() => parts.store?.close())],
  ];
  let first: { error: unknown } | undefined;
  for (const [name, step] of steps) {
    if (!step) { continue; }
    try {
      await step();
    } catch (error) {
      first ??= { error };
      await logger.error(LOG_MODULE, error, { shareId, action: `close ${name}` });
    }
  }
  if (first) { throw first.error; }
}

export async function connectShare(options: ShareConnectionOptions, start: ShareStart): Promise<ShareConnection> {
  const { shareId, logger } = options;
  const { storage, health } = watchStorageHealth(options.storage);
  const parts: Parts = {};
  try {
    parts.store = await openCollabStore({ storage, logger });
    return await connectParts(options, start, parts, health);
  } catch (error) {
    // The connect error is the one to surface; a part that failed to close is logged beside it.
    await closeParts(parts, logger, shareId).catch(() => undefined);
    await logger.error(LOG_MODULE, error, { shareId, action: `connect (${start.mode})` });
    throw error;
  }
}

async function connectParts(options: ShareConnectionOptions, start: ShareStart, parts: Parts, health: StorageHealth): Promise<ShareConnection> {
  const { shareId, shareKey, logger } = options;
  const store = parts.store as CollabStore;
  const [contentKey, relayToken, awarenessKey] = await Promise.all([
    // CONTRACT: documents/contracts/collaboration.md#share-key — every relay of the share takes the token the share key derives.
    deriveContentKey(shareKey), deriveRelayToken(shareKey), deriveAwarenessKey(shareKey),
  ]);
  const slot = createSwitchableTransport();
  const scheduler = options.network?.scheduler;
  const session = parts.session = createShareSession({
    shareId, contentKey, transport: slot, logger, index: store.index, createDoc: store.createDoc, ...(scheduler ? { scheduler } : {}),
  });
  // TRAP: a peer sends its presence once, when this device appears, which during a join is before the project exists.
  // A channel attached after that would drop it as an unknown kind.
  const presence = parts.presence = attachAwareness(session, { awarenessKey, logger });
  // INVARIANT: a member counts in the snapshot-writer election and the relay group only once its presence is published.
  presence.setLocal({ name: options.name, colour: peerColour("", presence.awareness.clientID), file: null, anchor: null, head: null });
  const relays = parts.relays = followShareRelays({
    session, slot, presence, inviteRelays: options.relays.map((relay) => relay.url), shareId, relayToken, contentKey, awarenessKey,
    cursorsFor: store.relayCursors, logger, ...(options.network ? { network: options.network } : {}),
  });
  const blobs = parts.blobs = attachBlobs(session, {
    contentKey, getBlob: (hash) => store.blobs.get(hash), logger, skipPeer: (peer) => presence.reportsOtherRelay(peer),
    ...(scheduler ? { scheduler } : {}),
  });
  const placed = await placeSharedProject(options.projects, shareId, session, start);
  const mirrors = trackMirror(options.startMirror, { folder: placed.folder, session, blobs, store }, parts);
  await mirrors.start();
  // A joiner opens the project right after this returns, so the files already on hand must be on disk first.
  if (start.mode === "join") { await parts.mirror?.idle(); }
  void logger.log("INFO", LOG_MODULE, "Connected a shared project", { shareId, folder: placed.folder, mode: start.mode, mirror: mirrors.state().kind });
  let closing: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((listener) => listener());
  const stops = [session.onStatus(notify), relays.onChange(notify), health.onChange(notify), mirrors.onChange(notify)];
  return {
    shareId, shareKey, folder: placed.folder, joinedId: placed.joinedId, session, presence, relays,
    get mirror() { return parts.mirror; },
    state: () => ({ status: session.status, relay: relays.current, persistenceFailure: health.failure, mirror: mirrors.state() }),
    onStateChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close: () => (closing ??= (async () => {
      stops.forEach((stop) => stop());
      listeners.clear();
      await closeParts(parts, logger, shareId);
      await logger.log("INFO", LOG_MODULE, "Closed a shared project connection", { shareId });
    })()),
  };
}

/** Starts the mirror into `parts.mirror` and keeps what the connection reports of it. */
function trackMirror(startMirror: MirrorFactory, input: Omit<Parameters<MirrorFactory>[0], "onStopped">, parts: Parts) {
  let state: MirrorState = { kind: "stopped", reason: "not started" };
  const listeners = new Set<() => void>();
  const set = (next: MirrorState): void => { state = next; listeners.forEach((listener) => listener()); };
  const apply = (result: MirrorStart): void => {
    if (result.kind === "running") {
      parts.mirror = result.mirror;
      set({ kind: "running" });
    } else {
      set({ kind: "busy", holder: result.holder });
    }
  };
  const onStopped = (reason: string): void => set({ kind: "stopped", reason });
  return {
    state: () => state,
    onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: async () => apply(await startMirror({ ...input, onStopped })),
  };
}
