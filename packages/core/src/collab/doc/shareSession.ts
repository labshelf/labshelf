// Opens a share session: its index and file docs kept in sync, encrypted, with the peers of a transport.
import * as Y from "yjs";
import type { DerivedShareKey } from "../shareKey/index.js";
import { readShareIndexDocFiles } from "../model/index.js";
import type { PeerId, PeerTransport } from "../transport/index.js";
import type { ILogger } from "../../ports/index.js";
import { DocSync } from "./docSync.js";
import { createSecureMesh, startInterval, systemScheduler, type Channel, type ChannelSpec, type SessionScheduler, type SessionPhase } from "../peer/index.js";

const DEFAULT_BACKGROUND_INTERVAL_MS = 2000;

export interface ShareSessionOptions {
  shareId: string;
  contentKey: DerivedShareKey;
  transport: PeerTransport;
  logger: ILogger;
  scheduler?: SessionScheduler;
  /** The index doc, already holding this device's stored state. */
  index?: Y.Doc;
  /** Creates the doc of a path the first time it is opened, already holding this device's stored state. */
  createDoc?: (path: string) => Y.Doc;
  /** How often one more text file listed in the index is opened and synced while peers are connected. */
  backgroundIntervalMs?: number;
}

export interface ShareSession {
  readonly index: Y.Doc;
  onIndexRoundTripAvailable(listener: () => void): () => void;
  indexRoundTrip(): Promise<boolean> | undefined;
  registerIndexRoundTrip(request: () => Promise<boolean> | undefined): () => void;
  /** The doc of a relative POSIX path, created and synced on first open. */
  openDoc(path: string): Y.Doc;
  docs(): ReadonlyMap<string, Y.Doc>;
  /** Called with each doc the session opens after the listener is added. */
  onDoc(listener: (docKey: string, doc: Y.Doc) => void): () => void;
  /** The transaction origin of updates that came from peers; a layer applying peer updates uses it so they are not sent back. */
  readonly remoteOrigin: unknown;
  readonly status: SessionPhase;
  onStatus(listener: (status: SessionPhase) => void): () => void;
  /** The peers connected right now. */
  readonly peers: readonly PeerId[];
  onPeer(listener: (peer: PeerId, joined: boolean) => void): () => void;
  /** Adds a message kind, such as awareness or blobs, over the same encrypted links. */
  channel(spec: ChannelSpec): Channel;
  /** Stops syncing and closes the transport; the docs stay with the caller. */
  close(): Promise<void>;
}

export function createShareSession(options: ShareSessionOptions): ShareSession {
  const roundTripListeners = new Set<() => void>();
  let roundTrip: (() => Promise<boolean> | undefined) | undefined;
  const scheduler = options.scheduler ?? systemScheduler;
  const mesh = createSecureMesh({ shareId: options.shareId, key: options.contentKey, transport: options.transport, logger: options.logger, scheduler });
  const index = options.index ?? new Y.Doc();
  const sync = new DocSync({ mesh, key: options.contentKey, index, createDoc: options.createDoc ?? (() => new Y.Doc()) });
  const stopBackground = startInterval(scheduler, options.backgroundIntervalMs ?? DEFAULT_BACKGROUND_INTERVAL_MS, () => {
    if (mesh.peers.length === 0) { return; }
    for (const [path, entry] of readShareIndexDocFiles(index)) {
      if (entry.kind === "text" && !sync.docs.has(path)) { sync.open(path); return; }
    }
  });
  return {
    index,
    indexRoundTrip: () => roundTrip?.(),
    onIndexRoundTripAvailable: (listener) => { roundTripListeners.add(listener); return () => { roundTripListeners.delete(listener); }; },
    registerIndexRoundTrip: (request) => {
      roundTrip = request;
      roundTripListeners.forEach((listener) => listener());
      return () => { if (roundTrip === request) { roundTrip = undefined; } };
    },
    openDoc: (path) => sync.open(path),
    docs: () => sync.docs,
    onDoc: (listener) => sync.onHold(listener),
    remoteOrigin: sync.origin,
    get status() { return mesh.status; },
    onStatus: (listener) => mesh.onStatus(listener),
    get peers() { return mesh.peers; },
    onPeer: (listener) => mesh.onPeer(listener),
    channel: (spec) => mesh.channel(spec),
    close: async () => {
      stopBackground();
      sync.close();
      await mesh.close();
    },
  };
}
