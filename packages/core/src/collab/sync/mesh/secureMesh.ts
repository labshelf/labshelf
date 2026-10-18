// Carries encrypted, authenticated channel messages between the admitted peers of a share over a transport.
import { bytesToHex } from "../../../encoding/index.js";
import type { ILogger } from "../../../ports/index.js";
import { openFrame, sealFrame, type WebCryptoKey } from "../../crypto/index.js";
import type { PeerId, PeerTransport } from "../../transport/index.js";
import {
  decodeDocPayload, decodeEnvelope, deriveDocId, DOC_ID_BYTES, encodeDocPayload, encodeEnvelope, MESSAGE_KIND, type Envelope,
} from "../wire/index.js";
import { MeshAdmission } from "./meshAdmission.js";
import { decodeSeqs, encodeSeqs, ReliableLink } from "./reliableLink.js";
import type { SessionScheduler } from "./scheduler.js";
import type { Channel, ChannelSpec, SecureMesh, SessionStatus } from "./channel.js";

const LOG_MODULE = "collab.sync";
const ACK_DOC_ID = new Uint8Array(DOC_ID_BYTES);

export interface SecureMeshOptions {
  shareId: string;
  /** Seals acks. */
  key: WebCryptoKey;
  transport: PeerTransport;
  logger: ILogger;
  scheduler: SessionScheduler;
}

export function createSecureMesh(options: SecureMeshOptions): SecureMesh {
  return new MeshSession(options);
}

class MeshSession implements SecureMesh {
  private state: SessionStatus = "open";
  private admission = new MeshAdmission();
  private links = new Map<PeerId, ReliableLink>();
  private channels = new Map<number, ChannelSpec>();
  private peerListeners = new Set<(peer: PeerId, joined: boolean) => void>();
  private statusListeners = new Set<(status: SessionStatus) => void>();
  private warned = new Set<PeerId>();
  private docIds = new Map<string, Promise<Uint8Array>>();
  private unsubscribe: (() => void)[];

  constructor(private options: SecureMeshOptions) {
    const { transport, logger } = options;
    this.unsubscribe = [
      transport.onPeerJoin((peer) => this.join(peer)),
      transport.onPeerLeave((peer) => this.leave(peer)),
      transport.onMessage((from, bytes) => {
        this.receive(from, bytes).catch((error) => void logger.error(LOG_MODULE, error, { peer: from, shareId: options.shareId }));
      }),
    ];
    transport.peers.forEach((peer) => this.join(peer));
  }

  get peers(): readonly PeerId[] { return [...this.admission.admitted]; }

  get status(): SessionStatus { return this.state; }

  onPeer(listener: (peer: PeerId, joined: boolean) => void): () => void {
    this.peerListeners.add(listener);
    return () => { this.peerListeners.delete(listener); };
  }

  onStatus(listener: (status: SessionStatus) => void): () => void {
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
    const frame = await sealFrame(spec.key, this.contextOf(docId, spec.name), encodeDocPayload(docKey, payload));
    for (const peer of to === "all" ? [...this.links.keys()] : [to]) {
      const link = this.links.get(peer);
      if (!link) { continue; }
      if (spec.reliable) { link.send((seq) => encodeEnvelope({ kind: spec.kind, seq, docId, frame })); }
      else { this.options.transport.send(peer, encodeEnvelope({ kind: spec.kind, seq: 0, docId, frame })); }
    }
  }

  private async receive(from: PeerId, bytes: Uint8Array): Promise<void> {
    if (!this.admission.admitted.includes(from)) { this.join(from); }
    const link = this.links.get(from);
    if (!link) { return; }
    const decoded = decodeEnvelope(bytes);
    if (!decoded.ok) { return this.warnOnce(from, "Dropped a message with a bad envelope", { error: decoded.error }); }
    const { envelope } = decoded;
    if (envelope.kind === MESSAGE_KIND.ack) { return this.receiveAck(from, link, envelope); }
    const spec = this.channels.get(envelope.kind);
    if (!spec) { return this.warnOnce(from, "Dropped a message of an unknown kind", { kind: envelope.kind }); }
    const opened = await openFrame(spec.key, this.contextOf(envelope.docId, spec.name), envelope.frame);
    if (!opened.ok) { return this.warnOnce(from, "Dropped a frame that failed to open", { kind: spec.name, error: opened.error }); }
    const message = decodeDocPayload(opened.bytes);
    // INVARIANT: the header doc id is what a relay files the frame under, so it must name the doc the plaintext edits.
    if (!message || bytesToHex(await this.docIdOf(message.docKey)) !== bytesToHex(envelope.docId)) {
      return this.warnOnce(from, "Dropped a frame whose doc key does not match its doc id", { kind: spec.name });
    }
    if (this.links.get(from) !== link || (envelope.seq > 0 && !link.accept(envelope.seq))) { return; }
    spec.onMessage(from, message.docKey, message.payload);
  }

  private async receiveAck(from: PeerId, link: ReliableLink, envelope: Envelope): Promise<void> {
    const opened = await openFrame(this.options.key, this.contextOf(envelope.docId, "ack"), envelope.frame);
    if (!opened.ok) { return this.warnOnce(from, "Dropped a frame that failed to open", { kind: "ack", error: opened.error }); }
    link.acknowledge(decodeSeqs(opened.bytes));
  }

  private join(peer: PeerId): void {
    if (this.status === "closed") { return; }
    if (this.links.has(peer)) { this.leave(peer); }
    if (this.admission.join(peer)) { this.openLink(peer); }
    this.setStatus(this.admission.full ? "meshFull" : "open");
  }

  private leave(peer: PeerId): void {
    this.closeLink(peer);
    const next = this.admission.leave(peer);
    if (next !== undefined) { this.openLink(next); }
    if (this.status !== "closed") { this.setStatus(this.admission.full ? "meshFull" : "open"); }
  }

  private openLink(peer: PeerId): void {
    const link = new ReliableLink({
      transmit: (bytes) => this.options.transport.send(peer, bytes),
      sendAck: (seqs) => { this.sendAck(peer, seqs).catch((error) => void this.options.logger.error(LOG_MODULE, error, { peer })); },
      onGiveUp: (seq) => this.warnOnce(peer, "Peer never acked a message; it resyncs on rejoin", { seq }),
    }, this.options.scheduler);
    this.links.set(peer, link);
    this.peerListeners.forEach((listener) => listener(peer, true));
  }

  private closeLink(peer: PeerId): void {
    this.links.get(peer)?.close();
    if (this.links.delete(peer)) { this.peerListeners.forEach((listener) => listener(peer, false)); }
  }

  private async sendAck(peer: PeerId, seqs: number[]): Promise<void> {
    const frame = await sealFrame(this.options.key, this.contextOf(ACK_DOC_ID, "ack"), encodeSeqs(seqs));
    if (this.links.has(peer)) {
      this.options.transport.send(peer, encodeEnvelope({ kind: MESSAGE_KIND.ack, seq: 0, docId: ACK_DOC_ID, frame }));
    }
  }

  private setStatus(next: SessionStatus): void {
    if (next === this.state) { return; }
    this.state = next;
    if (next === "meshFull") {
      void this.options.logger.log("INFO", LOG_MODULE, "Mesh is full; further peers wait for a free slot", { shareId: this.options.shareId });
    }
    this.statusListeners.forEach((listener) => listener(next));
  }

  private warnOnce(peer: PeerId, message: string, context: Record<string, unknown>): void {
    if (this.warned.has(peer)) { return; }
    this.warned.add(peer);
    void this.options.logger.log("WARN", LOG_MODULE, message, { peer, ...context });
  }

  private docIdOf(docKey: string): Promise<Uint8Array> {
    let id = this.docIds.get(docKey);
    if (!id) {
      id = deriveDocId(this.options.shareId, docKey);
      this.docIds.set(docKey, id);
    }
    return id;
  }

  private contextOf(docId: Uint8Array, name: string) {
    return { shareId: this.options.shareId, docKey: bytesToHex(docId), kind: name };
  }
}
