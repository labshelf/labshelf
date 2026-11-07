// Connects this device to one shared project: stored state, the peer session over its relays, presence, blobs and the disk mirror;
// the mirror itself starts through a MirrorFactory such as the leased one in leasedMirror.ts.
// CONTRACT: documents/contracts/collaboration.md#membership
import type { ILogger } from "../../ports/index.js";
import { createListeners } from "../../events/index.js";
import type { ShareKind } from "../shareIndexDoc.js";
import { derivePresenceShareKey, deriveContentShareKey, deriveRelayToken, type DerivedShareKey } from "../../shareKey/index.js";
import type { InviteRelay } from "../invite.js";
import {
  createSwitchableTransport, createRelaySelector, createRelayWatch, startRelaySelectionFollow, readRelayList, createRelayPresence, createRelayProbe,
  type RelayConnectionPortFactory, type RelayCursorStore, type SwitchableTransport,
} from "../relays/index.js";
import type { LeaseHolder } from "../mirror/index.js";
import { attachPresence, type PresenceStore, type RelayReport } from "../presence.js";
import { systemScheduler, type SessionPhase, type SessionScheduler } from "../channel.js";
import { attachShareBlobs, type ShareBlobExchange } from "../shareBlobs.js";
import { createShareSession, type ShareSession } from "../docSync.js";
import { derivePeerColour } from "../cursors.js";
import { openCollabStore, type CollabDeviceStateStorage, type CollabStore } from "./collabStore.js";
import { ensureSharedProject, type ShareProjects, type ShareStart } from "./sharedProject.js";
import { watchStorageHealth, type StorageHealth } from "./storageHealth.js";

const LOG_MODULE = "collab.connection";

export interface ConnectionMirror {
  /** Reports a changed path relative to the project folder; also call it when an editor lets a path go. */
  changed(path: string): void;
  idle(): Promise<void>;
  close(): Promise<void>;
}

/**
 * `busy` while another mirror owns the folder; the connection then runs without one.
 * `running` resolves with the mirror once the folder frees, or undefined when the connection closes first.
 */
export type MirrorStart =
  | { kind: "running"; mirror: ConnectionMirror }
  | { kind: "busy"; holder: LeaseHolder | "tab"; running?: Promise<ConnectionMirror | undefined> };

export interface MirrorInput {
  folder: string;
  /** What the folder holds, which picks the mirror's profile. */
  kind: ShareKind;
  session: ShareSession;
  blobs: ShareBlobExchange;
  store: CollabStore;
  /** Aborts when the connection closes; a mirror still waiting for the folder then gives up. */
  signal: AbortSignal;
  /** Called once when the mirror stops by itself; the share docs keep every edit, only the disk stops following them. */
  onStopped(reason: string): void;
}

export type MirrorFactory = (input: MirrorInput) => Promise<MirrorStart>;

export type MirrorState =
  | { kind: "running" }
  | { kind: "busy"; holder: LeaseHolder | "tab" }
  | { kind: "stopped"; reason: string };

export interface ShareRelayState {
  url: string;
  /** The epoch milliseconds the relay's hold ends, when it is held down. */
  downUntil: number | undefined;
}

export interface ShareRelays {
  /** The relay in use; undefined while none of the share's relays is usable. */
  readonly current: string | undefined;
  /** The relays in the order clients try them. */
  list(): ShareRelayState[];
  onChange(listener: () => void): () => void;
  /** Flushes and closes the relay in use; call it before closing the session. */
  close(): Promise<void>;
}

/** How a connection reaches its relays; tests pass in-process relays and a fake clock. */
export interface RelayNetwork {
  scheduler?: SessionScheduler;
  fetch?: typeof fetch;
  socketFactory?: RelayConnectionPortFactory;
}

interface ShareRelaysOptions {
  session: ShareSession;
  /** The transport the session was created over. */
  slot: SwitchableTransport;
  presence: PresenceStore;
  inviteRelays: readonly string[];
  shareId: string;
  relayToken: string;
  contentKey: DerivedShareKey;
  awarenessKey: DerivedShareKey;
  cursorsFor(relayUrl: string): RelayCursorStore;
  logger: ILogger;
  network?: RelayNetwork;
}

/** The index list, else the invite's while the index lists none, as the selector tries them. */
const shareRelayUrls = (index: ShareSession["index"], inviteRelays: readonly string[]): string[] => {
  const listed = readRelayList(index).map((entry) => entry.url);
  return listed.length > 0 ? listed : [...inviteRelays];
};

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function startShareRelays(options: ShareRelaysOptions): ShareRelays {
  const { session, slot, presence, inviteRelays, shareId, relayToken, contentKey, awarenessKey, cursorsFor, logger } = options;
  const { scheduler = systemScheduler, ...reach } = options.network ?? {};
  const watch = createRelayWatch({ shareId, relayToken, contentKey, awarenessKey, logger, scheduler, ...reach });
  const port = createRelayPresence(presence, watch);
  let report: RelayReport = { relay: null, relaysDown: {} };
  const selector = createRelaySelector({
    index: session.index, inviteRelays, probe: createRelayProbe({ logger, scheduler, ...(reach.fetch ? { fetch: reach.fetch } : {}) }), clock: scheduler, logger,
    presence: { ...port, publish: (next) => { report = next; port.publish(next); } },
  });
  // INVARIANT: only the connected client with the lowest awareness id writes relay snapshots, so two never race for one cursor.
  const follower = startRelaySelectionFollow({
    session, slot, selector, shareId, relayToken, contentKey, logger, scheduler, cursorsFor, isSnapshotWriter: () => presence.isLowestId(), ...reach,
  });
  return {
    get current() { return selector.current; },
    list: () => shareRelayUrls(session.index, inviteRelays).map((url) => ({ url, downUntil: report.relaysDown[url] })),
    onChange: (listener) => selector.onChange(() => listener()),
    close: async () => {
      selector.close();
      await follower.close();
      await watch.close();
    },
  };
}

export interface ShareConnectionState {
  readonly status: SessionPhase;
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
  /** Whether the share is a project or a Space. */
  readonly kind: ShareKind;
  /** The id of the project or Space a join created; undefined for share and resume. */
  readonly joinedId: string | undefined;
  readonly session: ShareSession;
  readonly presence: PresenceStore;
  readonly relays: ShareRelays;
  /** Fetches the blobs this device lacks from the peers. */
  readonly blobs: ShareBlobExchange;
  /** The running mirror; undefined while another mirror owns the folder. */
  readonly mirror: ConnectionMirror | undefined;
  /** Serves to peers the blobs `source` finds besides the share's own, such as the PDFs of a Space's papers; returns the stop. */
  serveBlobs(source: BlobSource): () => void;
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
  storage: CollabDeviceStateStorage;
  projects: ShareProjects;
  startMirror: MirrorFactory;
  /** This user's name in the presence peers see. */
  name: string;
  logger: ILogger;
  network?: RelayNetwork;
}

/** The bytes whose SHA-256 hex is `hash`, or undefined when the source does not hold them. */
export type BlobSource = (hash: string) => Promise<Uint8Array | undefined>;

async function findSourcedBlob(sources: ReadonlySet<BlobSource>, hash: string): Promise<Uint8Array | undefined> {
  for (const source of sources) {
    const bytes = await source(hash);
    if (bytes) { return bytes; }
  }
  return undefined;
}

/** What has started so far, closed in the order the parts depend on each other. */
interface Parts {
  store?: CollabStore;
  session?: ShareSession;
  presence?: PresenceStore;
  relays?: ShareRelays;
  blobs?: ShareBlobExchange;
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

// CONTRACT: documents/contracts/collaboration.md#share-key — every relay of the share takes the token the share key derives.
const deriveShareKeys = (shareKey: Uint8Array) =>
  Promise.all([deriveContentShareKey(shareKey), deriveRelayToken(shareKey), derivePresenceShareKey(shareKey)]);

async function connectParts(options: ShareConnectionOptions, start: ShareStart, parts: Parts, health: StorageHealth): Promise<ShareConnection> {
  const { shareId, shareKey, logger } = options;
  const store = parts.store as CollabStore;
  const [contentKey, relayToken, awarenessKey] = await deriveShareKeys(shareKey);
  const slot = createSwitchableTransport();
  const scheduler = options.network?.scheduler;
  const session = parts.session = createShareSession({
    shareId, contentKey, transport: slot, logger, index: store.index, createDoc: store.createDoc, ...(scheduler ? { scheduler } : {}),
  });
  // TRAP: a peer sends its presence once, when this device appears, which during a join is before the project exists.
  // A channel attached after that would drop it as an unknown kind.
  const presence = parts.presence = attachPresence(session, { awarenessKey, logger });
  // INVARIANT: a member counts in the snapshot-writer election and the relay group only once its presence is published.
  presence.setLocal({ name: options.name, colour: derivePeerColour("", presence.awareness.clientID), file: null, anchor: null, head: null });
  const relays = parts.relays = startShareRelays({
    session, slot, presence, inviteRelays: options.relays.map((relay) => relay.url), shareId, relayToken, contentKey, awarenessKey,
    cursorsFor: store.relayCursors, logger, ...(options.network ? { network: options.network } : {}),
  });
  const blobSources = new Set<BlobSource>();
  const blobs = parts.blobs = attachShareBlobs(session, {
    contentKey, getBlob: async (hash) => (await store.blobs.get(hash)) ?? (await findSourcedBlob(blobSources, hash)), logger, skipPeer: (peer) => presence.reportsOtherRelay(peer),
    ...(scheduler ? { scheduler } : {}),
  });
  const placed = await ensureSharedProject(options.projects, shareId, session, start);
  const mirrors = trackMirror(options.startMirror, { folder: placed.folder, kind: placed.kind, session, blobs, store }, parts, logger);
  await mirrors.start();
  // A joiner opens the project right after this returns, so the files already on hand must be on disk first.
  if (start.mode === "join") { await parts.mirror?.idle(); }
  void logger.log("INFO", LOG_MODULE, "Connected a shared project", { shareId, folder: placed.folder, mode: start.mode, mirror: mirrors.state().kind });
  let closing: Promise<void> | undefined;
  const listeners = createListeners();
  const notify = (): void => listeners.emit();
  const stops = [session.onStatus(notify), relays.onChange(notify), health.onChange(notify), mirrors.onChange(notify)];
  return {
    shareId, shareKey, folder: placed.folder, kind: placed.kind, joinedId: placed.joinedId, session, presence, relays, blobs,
    get mirror() { return parts.mirror; },
    serveBlobs: (source) => { blobSources.add(source); return () => { blobSources.delete(source); }; },
    state: () => ({ status: session.status, relay: relays.current, persistenceFailure: health.failure, mirror: mirrors.state() }),
    onStateChange: (listener) => listeners.add(listener),
    close: () => (closing ??= (async () => {
      stops.forEach((stop) => stop());
      mirrors.stop();
      listeners.clear();
      await closeParts(parts, logger, shareId);
      await logger.log("INFO", LOG_MODULE, "Closed a shared project connection", { shareId });
    })()),
  };
}

/** Starts the mirror into `parts.mirror`, also once a busy folder frees, and keeps what the connection reports of it. */
function trackMirror(startMirror: MirrorFactory, input: Omit<MirrorInput, "onStopped" | "signal">, parts: Parts, logger: ILogger) {
  let state: MirrorState = { kind: "stopped", reason: "not started" };
  const listeners = createListeners();
  const closed = new AbortController();
  const set = (next: MirrorState): void => { state = next; listeners.emit(); };
  const run = (mirror: ConnectionMirror): void => {
    if (closed.signal.aborted) {
      void mirror.close().catch((error: unknown) => logger.error(LOG_MODULE, error, { folder: input.folder, action: "close late mirror" }));
      return;
    }
    parts.mirror = mirror;
    set({ kind: "running" });
  };
  const apply = (result: MirrorStart): void => {
    if (result.kind === "running") { run(result.mirror); return; }
    set({ kind: "busy", holder: result.holder });
    result.running?.then((mirror) => { if (mirror) { run(mirror); } }, (error: unknown) => {
      void logger.error(LOG_MODULE, error, { folder: input.folder, action: "start mirror after the folder freed" });
    });
  };
  const onStopped = (reason: string): void => set({ kind: "stopped", reason });
  return {
    state: () => state,
    onChange: (listener: () => void) => listeners.add(listener),
    start: async () => apply(await startMirror({ ...input, onStopped, signal: closed.signal })),
    stop: () => closed.abort(),
  };
}
