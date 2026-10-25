// Numbers, acknowledges, resends and deduplicates the reliable messages exchanged with one peer.
import { startInterval, type SessionScheduler } from "./scheduler.js";

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
