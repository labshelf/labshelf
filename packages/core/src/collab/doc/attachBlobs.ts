// Serves blobs the app holds to the peers of a session and fetches the ones it lacks, chunk by encrypted chunk.
import type { ILogger } from "../../ports/index.js";
import type { WebCryptoKey } from "../shareKey/index.js";
import type { PeerId } from "../transport/index.js";
import { CHANNEL_KIND, systemScheduler, type SessionScheduler, type Channel } from "../peer/index.js";
import type { ShareSession } from "./shareSession.js";
import { BlobFetchError } from "./blobFetchError.js";
import {
  decodeBlobMessage,
  encodeBlobMissing,
  encodeBlobRequest,
  encodeBlobChunk,
  MAX_BLOB_BYTES,
  splitBlob,
  type BlobMessage,
} from "./blobMessage.js";
import { deriveSha256Hex } from "../../hash/index.js";

/** How long a peer may stay silent before the next one is asked, and how long a fetch waits for any peer to join. */
const BLOB_PEER_TIMEOUT_MS = 15_000;

interface BlobFetchDeps {
  hash: string;
  peers(): readonly PeerId[];
  request(peer: PeerId): void;
  scheduler: SessionScheduler;
  logger: ILogger;
  onSettled(): void;
}

class BlobFetch {
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
    try { actual = await deriveSha256Hex(bytes); } catch (error) { void this.deps.logger.error(LOG_MODULE, error, { hash: this.deps.hash }); actual = ""; }
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

interface BlobServing {
  channel: Channel;
  getBlob(hash: string): Promise<Uint8Array | undefined>;
  logger: ILogger;
}

async function heldBlob({ getBlob, logger }: BlobServing, hash: string): Promise<Uint8Array | undefined> {
  try {
    const blob = await getBlob(hash);
    if (blob && blob.length > MAX_BLOB_BYTES) {
      void logger.log("WARN", LOG_MODULE, "Refused to serve a blob above the size limit", { hash, size: blob.length });
      return undefined;
    }
    return blob;
  } catch (error) {
    void logger.error(LOG_MODULE, error, { hash });
    return undefined;
  }
}

/** `hash` must already be a valid SHA-256 hex string. */
async function serveBlob(serving: BlobServing, peer: PeerId, hash: string): Promise<void> {
  const blob = await heldBlob(serving, hash);
  if (!blob) { return serving.channel.send(peer, hash, encodeBlobMissing()); }
  const chunks = splitBlob(blob);
  for (const [index, chunk] of chunks.entries()) { await serving.channel.send(peer, hash, encodeBlobChunk(index, chunks.length, chunk)); }
}

const LOG_MODULE = "collab.blobs";
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface BlobsOptions {
  contentKey: WebCryptoKey;
  /** The bytes this device holds for a SHA-256 hex hash, or undefined. */
  getBlob(hash: string): Promise<Uint8Array | undefined>;
  logger: ILogger;
  scheduler?: SessionScheduler;
  /** True for a peer never asked for a blob, as a relay watcher that holds none. */
  skipPeer(peer: PeerId): boolean;
}

export interface BlobExchange {
  /** The bytes whose SHA-256 is `hash`, asked of the peers one by one; rejects with a BlobFetchError. */
  fetch(hash: string): Promise<Uint8Array>;
  /** Rejects the fetches in flight and stops answering. */
  close(): void;
}

export function attachBlobs(session: ShareSession, options: BlobsOptions): BlobExchange {
  const { logger } = options;
  const scheduler = options.scheduler ?? systemScheduler;
  const isSource = (peer: PeerId) => !options.skipPeer(peer);
  const fetches = new Map<string, BlobFetch>();
  let closed = false;

  const channel = session.channel({
    kind: CHANNEL_KIND.blob,
    name: "blob",
    key: options.contentKey,
    reliable: true,
    onMessage: (from, hash, payload) => {
      const message = decodeBlobMessage(payload);
      if (closed) { return; }
      if (!message) { return void logger.log("WARN", LOG_MODULE, "Dropped an unreadable blob message", { peer: from, hash }); }
      if (message.type === "request") { void serve(from, hash); } else { fetches.get(hash)?.receive(from, message); }
    },
  });

  const serve = (peer: PeerId, hash: string) => HASH_PATTERN.test(hash)
    ? serveBlob({ channel, getBlob: options.getBlob, logger }, peer, hash)
    : channel.send(peer, hash, encodeBlobMissing());

  const stopPeers = session.onPeer((peer, joined) => {
    if (joined && !isSource(peer)) { return; }
    fetches.forEach((fetch) => (joined ? fetch.peerJoined(peer) : fetch.peerLeft(peer)));
  });

  return {
    fetch: (hash) => {
      if (closed) { return Promise.reject(new BlobFetchError("closed", hash)); }
      if (!HASH_PATTERN.test(hash)) { return Promise.reject(new BlobFetchError("invalidHash", hash)); }
      const existing = fetches.get(hash);
      if (existing) { return existing.result; }
      const fetch = new BlobFetch({
        hash, scheduler, logger,
        peers: () => session.peers.filter(isSource),
        request: (peer) => void channel.send(peer, hash, encodeBlobRequest()),
        onSettled: () => void fetches.delete(hash),
      });
      fetches.set(hash, fetch);
      return fetch.result;
    },
    close: () => {
      closed = true;
      stopPeers();
      [...fetches.values()].forEach((fetch) => fetch.cancel());
    },
  };
}
