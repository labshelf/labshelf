// Carries encrypted, authenticated channel messages between the connected peers of a share over a transport.
import { bytesToHex } from "../../encoding/index.js";
import type { ILogger } from "../../ports/index.js";
import { openFrame, sealFrame, type DerivedShareKey } from "../shareKey/index.js";
import type { PeerId, PeerTransport } from "../transport/index.js";
import { decodeEnvelope, DOC_ID_BYTES, encodeEnvelope, MESSAGE_KIND, type Envelope } from "./envelope.js";
import { createDocIdCache, openDocFrame, sealDocFrame } from "./docMessage.js";
import { createEpochSource, decodeAck, encodeAck, ReliableConnection } from "./reliableChannel.js";
import type { SessionScheduler } from "./scheduler.js";
import type { Channel, ChannelSpec, PeerMesh, SessionPhase } from "./channel.js";

const LOG_MODULE = "collab.sync";
const ACK_DOC_ID = new Uint8Array(DOC_ID_BYTES);

export interface PeerMeshOptions {
  shareId: string;
  /** Seals acks. */
  key: DerivedShareKey;
  transport: PeerTransport;
  logger: ILogger;
  scheduler: SessionScheduler;
  /** Acks the reliable messages of kinds no channel reads, so a peer that is not a doc peer is not sent them again. */
  ackUnknownKinds?: boolean;
}

export function createSecureMesh(options: PeerMeshOptions): PeerMesh {
  return new MeshSession(options);
}

class MeshSession implements PeerMesh {
  private state: SessionPhase = "open";
  private links = new Map<PeerId, ReliableConnection>();
  private channels = new Map<number, ChannelSpec>();
  private peerListeners = new Set<(peer: PeerId, joined: boolean) => void>();
  private statusListeners = new Set<(status: SessionPhase) => void>();
  private warned = new Set<PeerId>();
  private nextEpoch = createEpochSource();
  private docIdOf: (docKey: string) => Promise<Uint8Array>;
  private unsubscribe: (() => void)[];

  constructor(private options: PeerMeshOptions) {
    const { transport, logger } = options;
    this.docIdOf = createDocIdCache(options.shareId);
    this.unsubscribe = [
      transport.onPeerJoin((peer) => this.join(peer)),
      transport.onPeerLeave((peer) => this.leave(peer)),
      transport.onMessage((from, bytes) => {
        this.receive(from, bytes).catch((error) => void logger.error(LOG_MODULE, error, { peer: from, shareId: options.shareId }));
      }),
    ];
    transport.peers.forEach((peer) => this.join(peer));
  }

  get peers(): readonly PeerId[] { return [...this.links.keys()]; }

  get status(): SessionPhase { return this.state; }

  onPeer(listener: (peer: PeerId, joined: boolean) => void): () => void {
    this.peerListeners.add(listener);
    return () => { this.peerListeners.delete(listener); };
  }

  onStatus(listener: (status: SessionPhase) => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  channel(spec: ChannelSpec): Channel {
    if (spec.kind === MESSAGE_KIND.ack || this.channels.has(spec.kind)) { throw new Error(`Message kind ${spec.kind} is taken`); }
    this.channels.set(spec.kind, spec);
    return {
      send: (to, docKey, payload) => this.send(spec, to, docKey, payload)
        .catch((error) => void this.options.logger.error(LOG_MODULE, error, { kind: spec.name, docKey })),
    };
  }

  async close(): Promise<void> {
    this.setStatus("closed");
    this.unsubscribe.forEach((stop) => stop());
    [...this.links.keys()].forEach((peer) => this.closeLink(peer));
    await this.options.transport.close();
  }

  private async send(spec: ChannelSpec, to: PeerId | "all", docKey: string, payload: Uint8Array): Promise<void> {
    const docId = await this.docIdOf(docKey);
    const frame = await sealDocFrame({ shareId: this.options.shareId, key: spec.key, name: spec.name }, docId, docKey, payload);
    for (const peer of to === "all" ? [...this.links.keys()] : [to]) {
      const link = this.links.get(peer);
      if (!link) { continue; }
      if (spec.reliable) { link.send((seq) => encodeEnvelope({ kind: spec.kind, epoch: link.epoch, seq, docId, frame })); }
      else { this.options.transport.send(peer, encodeEnvelope({ kind: spec.kind, epoch: 0n, seq: 0, docId, frame })); }
    }
  }

  private async receive(from: PeerId, bytes: Uint8Array): Promise<void> {
    if (!this.links.has(from)) { this.join(from); }
    const link = this.links.get(from);
    if (!link) { return; }
    const decoded = decodeEnvelope(bytes);
    if (!decoded.ok) { return this.warnOnce(from, "Dropped a message with a bad envelope", { error: decoded.error }); }
    const { envelope } = decoded;
    if (envelope.kind === MESSAGE_KIND.ack) { return this.receiveAck(from, link, envelope); }
    const spec = this.channels.get(envelope.kind);
    if (!spec && this.options.ackUnknownKinds) {
      // INVARIANT: the frame stays unopened, so this acks a seq no one authenticated; such a mesh discards every one of them.
      if (envelope.seq > 0) { link.accept(envelope.epoch, envelope.seq); }
      return;
    }
    if (!spec) { return this.warnOnce(from, "Dropped a message of an unknown kind", { kind: envelope.kind }); }
    const message = await openDocFrame({ shareId: this.options.shareId, key: spec.key, name: spec.name }, envelope, this.docIdOf);
    if (!message.ok && message.error === "docMismatch") {
      return this.warnOnce(from, "Dropped a frame whose doc key does not match its doc id", { kind: spec.name });
    }
    if (!message.ok) { return this.warnOnce(from, "Dropped a frame that failed to open", { kind: spec.name, error: message.error }); }
    if (this.links.get(from) !== link || (envelope.seq > 0 && !link.accept(envelope.epoch, envelope.seq))) { return; }
    spec.onMessage(from, message.docKey, message.payload);
  }

  private async receiveAck(from: PeerId, link: ReliableConnection, envelope: Envelope): Promise<void> {
    const opened = await openFrame(this.options.key, this.contextOf(envelope.docId, "ack"), envelope.frame);
    if (!opened.ok) { return this.warnOnce(from, "Dropped a frame that failed to open", { kind: "ack", error: opened.error }); }
    const { epoch, seqs } = decodeAck(opened.bytes);
    link.acknowledge(epoch, seqs);
  }

  private join(peer: PeerId): void {
    if (this.status === "closed") { return; }
    if (this.links.has(peer)) { this.leave(peer); }
    this.openLink(peer);
  }

  private leave(peer: PeerId): void {
    this.closeLink(peer);
  }

  private openLink(peer: PeerId): void {
    const link = new ReliableConnection({
      transmit: (bytes) => this.options.transport.send(peer, bytes),
      sendAck: (epoch, seqs) => { this.sendAck(peer, epoch, seqs).catch((error) => void this.options.logger.error(LOG_MODULE, error, { peer })); },
      onGiveUp: (seq) => this.warnOnce(peer, "Peer never acked a message; it resyncs on rejoin", { seq }),
    }, this.options.scheduler, this.nextEpoch());
    this.links.set(peer, link);
    this.peerListeners.forEach((listener) => listener(peer, true));
  }

  private closeLink(peer: PeerId): void {
    this.links.get(peer)?.close();
    if (this.links.delete(peer)) { this.peerListeners.forEach((listener) => listener(peer, false)); }
  }

  private async sendAck(peer: PeerId, epoch: bigint, seqs: number[]): Promise<void> {
    const frame = await sealFrame(this.options.key, this.contextOf(ACK_DOC_ID, "ack"), encodeAck(epoch, seqs));
    if (this.links.has(peer)) {
      this.options.transport.send(peer, encodeEnvelope({ kind: MESSAGE_KIND.ack, epoch: 0n, seq: 0, docId: ACK_DOC_ID, frame }));
    }
  }

  private setStatus(next: SessionPhase): void {
    if (next === this.state) { return; }
    this.state = next;
    this.statusListeners.forEach((listener) => listener(next));
  }

  private warnOnce(peer: PeerId, message: string, context: Record<string, unknown>): void {
    if (this.warned.has(peer)) { return; }
    this.warned.add(peer);
    void this.options.logger.log("WARN", LOG_MODULE, message, { peer, ...context });
  }

  private contextOf(docId: Uint8Array, name: string) {
    return { shareId: this.options.shareId, docKey: bytesToHex(docId), kind: name };
  }
}
