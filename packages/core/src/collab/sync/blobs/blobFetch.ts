// Fetches one blob from the peers of a session one at a time, verifying its SHA-256 before handing the bytes out.
import { sha256Hex } from "../../../hash/index.js";
import type { ILogger } from "../../../ports/index.js";
import type { PeerId } from "../../transport/index.js";
import type { SessionScheduler } from "../mesh/index.js";
import { BlobFetchError } from "./blobFetchError.js";
import type { BlobMessage } from "./blobMessage.js";

const LOG_MODULE = "collab.blobs";

/** How long a peer may stay silent before the next one is asked, and how long a fetch waits for any peer to join. */
const BLOB_PEER_TIMEOUT_MS = 15_000;

export interface BlobFetchDeps {
  hash: string;
  peers(): readonly PeerId[];
  request(peer: PeerId): void;
  scheduler: SessionScheduler;
  logger: ILogger;
  onSettled(): void;
}

export class BlobFetch {
  readonly result: Promise<Uint8Array>;
  private resolve!: (bytes: Uint8Array) => void;
  private reject!: (error: BlobFetchError) => void;
  private asked = new Set<PeerId>();
  private current: PeerId | undefined;
  private chunks = new Map<number, Uint8Array>();
  private total = 0;
  private failure: "unavailable" | "corrupt" = "unavailable";
  private verifying = false;
  private settled = false;
  private stopTimer = () => {};

  constructor(private deps: BlobFetchDeps) {
    this.result = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.advance();
  }

  receive(from: PeerId, message: BlobMessage): void {
    if (this.settled || this.verifying || from !== this.current) { return; }
    if (message.type === "missing") { return this.advance(); }
    if (message.type !== "chunk") { return; }
    if (this.total === 0) { this.total = message.total; }
    if (message.total !== this.total) { return this.dropPeer(from, "Peer changed the chunk count of a blob"); }
    this.chunks.set(message.index, message.bytes);
    this.startTimer();
    if (this.chunks.size === this.total) { void this.verify(from); }
  }

  peerJoined(peer: PeerId): void {
    if (!this.settled && !this.verifying && this.current === undefined) { this.ask(peer); }
  }

  peerLeft(peer: PeerId): void {
    if (!this.settled && !this.verifying && peer === this.current) { this.advance(); }
  }

  cancel(): void {
    this.settle(() => this.reject(new BlobFetchError("closed", this.deps.hash)));
  }

  /** Asks the next peer not asked yet, or waits for one to join until the timer runs out. */
  private advance(): void {
    this.current = undefined;
    this.chunks.clear();
    this.total = 0;
    this.startTimer();
    const peer = this.nextPeer();
    if (peer !== undefined) { this.ask(peer); }
  }

  private ask(peer: PeerId): void {
    this.asked.add(peer);
    this.current = peer;
    this.startTimer();
    this.deps.request(peer);
  }

  private nextPeer(): PeerId | undefined {
    return this.deps.peers().find((peer) => !this.asked.has(peer));
  }

  private startTimer(): void {
    this.stopTimer();
    this.stopTimer = this.deps.scheduler.after(BLOB_PEER_TIMEOUT_MS, () => this.timeOut());
  }

  private timeOut(): void {
    if (this.settled || this.verifying) { return; }
    if (this.current === undefined || this.nextPeer() === undefined) { return this.fail(); }
    this.dropPeer(this.current, "Peer did not answer a blob request in time");
  }

  private dropPeer(peer: PeerId, message: string): void {
    void this.deps.logger.log("WARN", LOG_MODULE, message, { peer, hash: this.deps.hash });
    this.advance();
  }

  private async verify(from: PeerId): Promise<void> {
    this.verifying = true;
    this.stopTimer();
    const bytes = joinChunks([...this.chunks.entries()].sort(([a], [b]) => a - b).map(([, chunk]) => chunk));
    let actual: string;
    try { actual = await sha256Hex(bytes); } catch (error) { void this.deps.logger.error(LOG_MODULE, error, { hash: this.deps.hash }); actual = ""; }
    this.verifying = false;
    if (this.settled) { return; }
    if (actual === this.deps.hash) { return this.settle(() => this.resolve(bytes)); }
    this.failure = "corrupt";
    this.dropPeer(from, "Rejected a blob that does not match its hash");
  }

  private fail(): void {
    this.settle(() => this.reject(new BlobFetchError(this.failure, this.deps.hash)));
  }

  private settle(finish: () => void): void {
    if (this.settled) { return; }
    this.settled = true;
    this.stopTimer();
    finish();
    this.deps.onSettled();
  }
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
