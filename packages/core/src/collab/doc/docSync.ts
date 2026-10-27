// Keeps the docs of a share in step with its peers: each doc's catch-up over the mesh, and the session that opens them.
import * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import type { DerivedShareKey } from "../invite/index.js";
import type { PeerId, PeerTransport } from "../transport/index.js";
import { MESSAGE_KIND, createSecureMesh, startInterval, systemScheduler, type Channel, type ChannelSpec, type PeerMesh, type SessionScheduler, type SessionPhase } from "../peer/index.js";
import { readShareIndexDocFiles } from "./shareIndexDoc.js";

// CONTRACT: documents/contracts/collaboration.md#messages
/** A relative POSIX path never starts with "/", so no file doc can take the index's key. */
export const INDEX_DOC_KEY = "/index";

export interface DocSyncOptions {
  mesh: PeerMesh;
  key: DerivedShareKey;
  index: Y.Doc;
  createDoc: (path: string) => Y.Doc;
}

export class DocSync {
  readonly docs = new Map<string, Y.Doc>();
  /** Marks updates that came from peers, so the relay sync does not store them again. */
  readonly origin = Symbol("remote");
  private readonly holdListeners = new Set<(docKey: string, doc: Y.Doc) => void>();
  private readonly step1Sent = new Map<PeerId, Set<string>>();
  private readonly detach: (() => void)[] = [];
  private readonly step1: Channel;
  private readonly step2: Channel;

  constructor(private options: DocSyncOptions) {
    const { mesh, key } = options;
    const channel = (kind: number, name: string, onMessage: (from: PeerId, docKey: string, payload: Uint8Array) => void) =>
      mesh.channel({ kind, name, key, reliable: true, onMessage });
    this.step1 = channel(MESSAGE_KIND.syncStep1, "syncStep1", (from, docKey, vector) => this.answer(from, docKey, vector));
    this.step2 = channel(MESSAGE_KIND.syncStep2, "syncStep2", (_from, docKey, update) => this.apply(docKey, update));
    this.detach.push(mesh.onPeer((peer, joined) => {
      this.step1Sent.delete(peer);
      if (joined) { for (const docKey of this.docs.keys()) { this.sendStep1(peer, docKey); } }
    }));
    this.hold(INDEX_DOC_KEY, options.index);
    for (const peer of mesh.peers) { this.sendStep1(peer, INDEX_DOC_KEY); }
  }

  open(path: string): Y.Doc {
    const held = this.docs.get(path);
    if (held) { return held; }
    if (path.startsWith("/")) { throw new Error(`Doc key "${path}" is not a relative path`); }
    const doc = this.options.createDoc(path);
    this.hold(path, doc);
    for (const peer of this.options.mesh.peers) { this.sendStep1(peer, path); }
    return doc;
  }

  onHold(listener: (docKey: string, doc: Y.Doc) => void): () => void {
    this.holdListeners.add(listener);
    return () => { this.holdListeners.delete(listener); };
  }

  close(): void {
    this.detach.forEach((stop) => stop());
  }

  private hold(docKey: string, doc: Y.Doc): void {
    this.docs.set(docKey, doc);
    this.holdListeners.forEach((listener) => listener(docKey, doc));
  }

  private sendStep1(peer: PeerId, docKey: string): void {
    const sent = this.step1Sent.get(peer) ?? new Set<string>();
    this.step1Sent.set(peer, sent);
    sent.add(docKey);
    void this.step1.send(peer, docKey, Y.encodeStateVector(this.docs.get(docKey)!));
  }

  /** A doc this device does not hold is left to the background sync, which opens it and asks in turn. */
  private answer(from: PeerId, docKey: string, vector: Uint8Array): void {
    const doc = this.docs.get(docKey);
    if (!doc) { return; }
    void this.step2.send(from, docKey, Y.encodeStateAsUpdate(doc, vector));
    if (!this.step1Sent.get(from)?.has(docKey)) { this.sendStep1(from, docKey); }
  }

  private apply(docKey: string, update: Uint8Array): void {
    const doc = this.docs.get(docKey);
    if (doc) { Y.applyUpdate(doc, update, this.origin); }
  }
}

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
