// Serves blobs the app holds to the peers of a session and fetches the ones it lacks, chunk by encrypted chunk.
import type { ILogger } from "../../../ports/index.js";
import type { WebCryptoKey } from "../../crypto/index.js";
import type { PeerId } from "../../transport/index.js";
import { systemScheduler, type SessionScheduler } from "../mesh/index.js";
import type { ShareSession } from "../shareSession.js";
import { CHANNEL_KIND } from "../wire/index.js";
import { BlobFetch } from "./blobFetch.js";
import { BlobFetchError } from "./blobFetchError.js";
import { decodeBlobMessage, encodeBlobMissing, encodeBlobRequest } from "./blobMessage.js";
import { serveBlob } from "./serveBlob.js";

const LOG_MODULE = "collab.blobs";
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface BlobsOptions {
  contentKey: WebCryptoKey;
  /** The bytes this device holds for a SHA-256 hex hash, or undefined. */
  getBlob(hash: string): Promise<Uint8Array | undefined>;
  logger: ILogger;
  scheduler?: SessionScheduler;
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
        peers: () => session.peers,
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
