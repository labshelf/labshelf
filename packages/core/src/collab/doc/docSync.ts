// Catches the index doc and the held file docs of a share up with each connected peer through Yjs state vectors.
import * as Y from "yjs";
import type { DerivedShareKey } from "../shareKey/index.js";
import type { PeerId } from "../transport/index.js";
import { MESSAGE_KIND, type Channel, type SecureMesh } from "../peer/index.js";

// CONTRACT: documents/contracts/collaboration.md#messages
/** A relative POSIX path never starts with "/", so no file doc can take the index's key. */
export const INDEX_DOC_KEY = "/index";

export interface DocSyncOptions {
  mesh: SecureMesh;
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
