// Numbers, acknowledges, resends and deduplicates the reliable messages exchanged with one peer.
import { every, type SessionScheduler } from "./scheduler.js";

export const ACK_DELAY_MS = 200;
export const RESEND_AFTER_MS = 2000;
/** A peer that has not acked a message after this many sends is not reading it; a rejoin resyncs what it missed. */
export const MAX_SEND_ATTEMPTS = 8;

interface Pending { bytes: Uint8Array; sentAt: number; attempts: number }

export interface LinkIo {
  /** Sends envelope bytes; `seq` goes into the header so a resend reuses the same bytes. */
  transmit(bytes: Uint8Array): void;
  sendAck(seqs: number[]): void;
  onGiveUp(seq: number): void;
}

export class ReliableLink {
  private nextSeq = 1;
  private pending = new Map<number, Pending>();
  /** Every seq at or below the floor arrived; `above` holds the ones past a gap. */
  private floor = 0;
  private above = new Set<number>();
  private ackQueue: number[] = [];
  private cancelAck: (() => void) | undefined;
  private stopResend: () => void;

  constructor(private io: LinkIo, private scheduler: SessionScheduler) {
    this.stopResend = every(scheduler, RESEND_AFTER_MS, () => this.resendDue());
  }

  send(build: (seq: number) => Uint8Array): void {
    const seq = this.nextSeq++;
    const bytes = build(seq);
    this.pending.set(seq, { bytes, sentAt: this.scheduler.now(), attempts: 1 });
    this.io.transmit(bytes);
  }

  /** Records an arrived seq and queues its ack; false for a duplicate, which the caller drops. */
  accept(seq: number): boolean {
    this.ackQueue.push(seq);
    this.cancelAck ??= this.scheduler.after(ACK_DELAY_MS, () => this.flushAcks());
    if (seq <= this.floor || this.above.has(seq)) { return false; }
    this.above.add(seq);
    while (this.above.delete(this.floor + 1)) { this.floor += 1; }
    return true;
  }

  acknowledge(seqs: readonly number[]): void {
    for (const seq of seqs) { this.pending.delete(seq); }
  }

  close(): void {
    this.stopResend();
    this.cancelAck?.();
    this.pending.clear();
  }

  private flushAcks(): void {
    this.cancelAck = undefined;
    const seqs = this.ackQueue;
    this.ackQueue = [];
    this.io.sendAck(seqs);
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

export function encodeSeqs(seqs: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(seqs.length * 4);
  const view = new DataView(bytes.buffer);
  seqs.forEach((seq, i) => view.setUint32(i * 4, seq));
  return bytes;
}

export function decodeSeqs(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: Math.floor(bytes.length / 4) }, (_, i) => view.getUint32(i * 4));
}
