// Declares the mesh a share session runs on and the channels each message kind travels through, the clock and envelope header around them,
// and the reliable and doc-bound messages they carry.
import { bytesToHex } from "../../encoding/index.js";
import { openFrame, sealFrame, type DerivedShareKey, type FrameError } from "../invite/index.js";
import type { PeerId } from "../transport/index.js";

export type SessionPhase = "open" | "closed";

export interface ChannelSpec {
  /** Envelope kind byte; extensions use EXTENSION_KIND_MIN and above. */
  kind: number;
  /** Payload kind bound into the frame's additional data. */
  name: string;
  key: DerivedShareKey;
  /** A reliable message is numbered, acked and resent until acked. */
  reliable: boolean;
  onMessage(from: PeerId, docKey: string, payload: Uint8Array): void;
}

export interface Channel {
  /** Sends to one connected peer or to all of them. Failures are logged, never thrown. */
  send(to: PeerId | "all", docKey: string, payload: Uint8Array): Promise<void>;
}

export interface PeerMesh {
  readonly peers: readonly PeerId[];
  onPeer(listener: (peer: PeerId, joined: boolean) => void): () => void;
  readonly status: SessionPhase;
  onStatus(listener: (status: SessionPhase) => void): () => void;
  channel(spec: ChannelSpec): Channel;
  close(): Promise<void>;
}

// ---- Clock

export interface SessionScheduler {
  now(): number;
  /** Runs `fn` once after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const systemScheduler: SessionScheduler = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

/** Runs `fn` every `ms` until the returned function is called. */
export function startInterval(scheduler: SessionScheduler, ms: number, fn: () => void): () => void {
  let cancel = scheduler.after(ms, tick);
  function tick(): void {
    cancel = scheduler.after(ms, tick);
    fn();
  }
  return () => cancel();
}

// ---- Envelope

// CONTRACT: documents/contracts/collaboration.md#messages
export const ENVELOPE_VERSION = 3;

export const MESSAGE_KIND = { syncStep1: 1, syncStep2: 2, update: 3, ack: 4 } as const;

/** Kinds from here to 255 belong to channels layered on a session, such as awareness and blobs. */
export const EXTENSION_KIND_MIN = 16;

// CONTRACT: documents/contracts/collaboration.md#messages
export const CHANNEL_KIND = { awareness: EXTENSION_KIND_MIN, blob: EXTENSION_KIND_MIN + 1 } as const;

export const DOC_ID_BYTES = 16;

/** version (1) | kind (1) | epoch, big-endian (8) | sequence, big-endian (4) | doc id (16). */
export const ENVELOPE_HEADER_BYTES = 14 + DOC_ID_BYTES;

export interface Envelope {
  kind: number;
  /** The sender's link to this peer, higher for each link it opens; 0 on a message that is never acked or resent. */
  epoch: bigint;
  /** Per-link sequence number of a reliable message; 0 marks a message that is never acked or resent. */
  seq: number;
  docId: Uint8Array;
  frame: Uint8Array;
}

export type EnvelopeResult = { ok: true; envelope: Envelope } | { ok: false; error: "tooShort" | "badVersion" };

export function encodeEnvelope({ kind, epoch, seq, docId, frame }: Envelope): Uint8Array {
  const bytes = new Uint8Array(ENVELOPE_HEADER_BYTES + frame.length);
  bytes[0] = ENVELOPE_VERSION;
  bytes[1] = kind;
  const view = new DataView(bytes.buffer);
  view.setBigUint64(2, epoch);
  view.setUint32(10, seq);
  bytes.set(docId, 14);
  bytes.set(frame, ENVELOPE_HEADER_BYTES);
  return bytes;
}

/** Never throws on hostile input: every failure is a typed result. */
export function decodeEnvelope(bytes: Uint8Array): EnvelopeResult {
  if (bytes.length < ENVELOPE_HEADER_BYTES) { return { ok: false, error: "tooShort" }; }
  if (bytes[0] !== ENVELOPE_VERSION) { return { ok: false, error: "badVersion" }; }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = { kind: bytes[1]!, epoch: view.getBigUint64(2), seq: view.getUint32(10) };
  return {
    ok: true,
    envelope: { ...header, docId: bytes.slice(14, ENVELOPE_HEADER_BYTES), frame: bytes.slice(ENVELOPE_HEADER_BYTES) },
  };
}

// ---- Doc ids and doc frames

// CONTRACT: documents/contracts/collaboration.md#messages
export async function deriveDocId(shareId: string, docKey: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${shareId}\0${docKey}`));
  return new Uint8Array(digest, 0, DOC_ID_BYTES);
}

// CONTRACT: documents/contracts/collaboration.md#messages
function encodeDocPayload(docKey: string, payload: Uint8Array): Uint8Array {
  const key = new TextEncoder().encode(docKey);
  if (key.length > 0xffff) { throw new Error(`Doc key of ${key.length} bytes exceeds the 65535-byte limit`); }
  const bytes = new Uint8Array(2 + key.length + payload.length);
  new DataView(bytes.buffer).setUint16(0, key.length);
  bytes.set(key, 2);
  bytes.set(payload, 2 + key.length);
  return bytes;
}

/** Undefined for bytes too short for the key length they announce. */
function decodeDocPayload(bytes: Uint8Array): { docKey: string; payload: Uint8Array } | undefined {
  if (bytes.length < 2) { return undefined; }
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  if (bytes.length < 2 + length) { return undefined; }
  return { docKey: new TextDecoder().decode(bytes.subarray(2, 2 + length)), payload: bytes.subarray(2 + length) };
}

/** The share, key and payload kind name a frame is bound to. */
export interface DocFrameContext { shareId: string; key: DerivedShareKey; name: string }

export type OpenedDocFrame =
  | { ok: true; docKey: string; payload: Uint8Array }
  | { ok: false; error: FrameError | "docMismatch" };

/** Derives doc ids once per doc key, since every message of a doc needs its id. */
export function createDocIdCache(shareId: string): (docKey: string) => Promise<Uint8Array> {
  const ids = new Map<string, Promise<Uint8Array>>();
  return (docKey) => {
    let id = ids.get(docKey);
    if (!id) {
      id = deriveDocId(shareId, docKey);
      ids.set(docKey, id);
    }
    return id;
  };
}

// CONTRACT: documents/contracts/collaboration.md#messages
export function sealDocFrame(context: DocFrameContext, docId: Uint8Array, docKey: string, payload: Uint8Array): Promise<Uint8Array> {
  return sealFrame(context.key, frameContext(context, docId), encodeDocPayload(docKey, payload));
}

export async function openDocFrame(
  context: DocFrameContext, envelope: Envelope, docIdOf: (docKey: string) => Promise<Uint8Array>,
): Promise<OpenedDocFrame> {
  const opened = await openFrame(context.key, frameContext(context, envelope.docId), envelope.frame);
  if (!opened.ok) { return opened; }
  const message = decodeDocPayload(opened.bytes);
  // INVARIANT: the header doc id is what a relay files the frame under, so it must name the doc the plaintext edits.
  if (!message || bytesToHex(await docIdOf(message.docKey)) !== bytesToHex(envelope.docId)) { return { ok: false, error: "docMismatch" }; }
  return { ok: true, docKey: message.docKey, payload: message.payload };
}

function frameContext(context: DocFrameContext, docId: Uint8Array) {
  return { shareId: context.shareId, docKey: bytesToHex(docId), kind: context.name };
}

// ---- Reliable delivery

export const ACK_DELAY_MS = 200;
export const RESEND_AFTER_MS = 2000;
/** A peer that has not acked a message after this many sends is not reading it; a rejoin resyncs what it missed. */
export const MAX_SEND_ATTEMPTS = 8;
/** Past this many seqs held beyond a gap, the oldest gap has used up its resends and counts as delivered. */
const MAX_SEQS_PAST_GAP = 1024;

interface Pending { bytes: Uint8Array; sentAt: number; attempts: number }

export interface ConnectionIo {
  /** Sends envelope bytes; `seq` goes into the header so a resend reuses the same bytes. */
  transmit(bytes: Uint8Array): void;
  /** Acks seqs of the peer's link `epoch`. */
  sendAck(epoch: bigint, seqs: number[]): void;
  onGiveUp(seq: number): void;
}

export class ReliableConnection {
  private nextSeq = 1;
  private pending = new Map<number, Pending>();
  /** The epoch of the peer's link whose seqs `floor`, `above` and `ackQueue` track; 0 until its first reliable message. */
  private peerEpoch = 0n;
  /** Every seq at or below the floor arrived; `above` holds the ones past a gap. */
  private floor = 0;
  private above = new Set<number>();
  private ackQueue: number[] = [];
  private cancelAck: (() => void) | undefined;
  private stopResend: () => void;

  /** `epoch` names this side's link to the peer, higher than any link this side opened before it. */
  constructor(private io: ConnectionIo, private scheduler: SessionScheduler, readonly epoch: bigint) {
    this.stopResend = startInterval(scheduler, RESEND_AFTER_MS, () => this.resendDue());
  }

  send(build: (seq: number) => Uint8Array): void {
    const seq = this.nextSeq++;
    const bytes = build(seq);
    this.pending.set(seq, { bytes, sentAt: this.scheduler.now(), attempts: 1 });
    this.io.transmit(bytes);
  }

  /** Records an arrived seq and queues its ack; false for a duplicate, epoch 0 or an older epoch, which the caller drops. */
  accept(epoch: bigint, seq: number): boolean {
    // CONTRACT: documents/contracts/collaboration.md#messages
    if (epoch === 0n || epoch < this.peerEpoch) { return false; }
    if (epoch > this.peerEpoch) { this.adoptPeerEpoch(epoch); }
    this.ackQueue.push(seq);
    this.cancelAck ??= this.scheduler.after(ACK_DELAY_MS, () => this.flushAcks());
    if (seq <= this.floor || this.above.has(seq)) { return false; }
    this.above.add(seq);
    // TRAP: a link adopted mid-sequence never sees the seqs below its first one, so without this `above` grows forever.
    if (this.above.size > MAX_SEQS_PAST_GAP) { this.floor = Math.min(...this.above) - 1; }
    while (this.above.delete(this.floor + 1)) { this.floor += 1; }
    return true;
  }

  acknowledge(epoch: bigint, seqs: readonly number[]): void {
    // TRAP: an ack of the link this one replaced names the same small seqs, so it must not clear this link's pending ones.
    if (epoch !== this.epoch) { return; }
    for (const seq of seqs) { this.pending.delete(seq); }
  }

  close(): void {
    this.stopResend();
    this.cancelAck?.();
    this.pending.clear();
  }

  private adoptPeerEpoch(epoch: bigint): void {
    this.peerEpoch = epoch;
    this.floor = 0;
    this.above.clear();
    this.ackQueue = [];
  }

  private flushAcks(): void {
    this.cancelAck = undefined;
    const seqs = this.ackQueue;
    this.ackQueue = [];
    this.io.sendAck(this.peerEpoch, seqs);
  }

  private resendDue(): void {
    const cutoff = this.scheduler.now() - RESEND_AFTER_MS;
    for (const [seq, entry] of this.pending) {
      if (entry.sentAt > cutoff) { continue; }
      if (entry.attempts >= MAX_SEND_ATTEMPTS) {
        this.pending.delete(seq);
        this.io.onGiveUp(seq);
        continue;
      }
      entry.attempts += 1;
      entry.sentAt = this.scheduler.now();
      this.io.transmit(entry.bytes);
    }
  }
}

/**
 * Returns a sender's epoch source: each epoch is the open time in ms in the high 48 bits and 16 random bits below,
 * and above every epoch it returned before even when the clock goes backwards.
 */
export function createEpochSource(): () => bigint {
  let last = 0n;
  return () => {
    // CONTRACT: documents/contracts/collaboration.md#messages
    const [random] = crypto.getRandomValues(new Uint16Array(1));
    const fromClock = (BigInt(Date.now()) << 16n) | BigInt(random!);
    last = fromClock > last ? fromClock : last + 1n;
    return last;
  };
}

/** The ack payload: the acked link's epoch (8 bytes), then its seqs, 4 bytes each. */
export function encodeAck(epoch: bigint, seqs: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(8 + seqs.length * 4);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, epoch);
  seqs.forEach((seq, i) => view.setUint32(8 + i * 4, seq));
  return bytes;
}

/** Epoch 0, which no link has, for a payload too short to carry one. */
export function decodeAck(bytes: Uint8Array): { epoch: bigint; seqs: number[] } {
  if (bytes.length < 8) { return { epoch: 0n, seqs: [] }; }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seqs = Array.from({ length: Math.floor((bytes.length - 8) / 4) }, (_, i) => view.getUint32(8 + i * 4));
  return { epoch: view.getBigUint64(0), seqs };
}
