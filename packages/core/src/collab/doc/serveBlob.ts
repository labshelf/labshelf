// Answers a peer's blob request with the held bytes in encrypted chunks, or with a "missing" reply.
import type { ILogger } from "../../ports/index.js";
import type { PeerId } from "../transport/index.js";
import type { Channel } from "../peer/index.js";
import { encodeBlobChunk, encodeBlobMissing, MAX_BLOB_BYTES, splitBlob } from "./blobMessage.js";

const LOG_MODULE = "collab.blobs";

export interface BlobServing {
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
export async function serveBlob(serving: BlobServing, peer: PeerId, hash: string): Promise<void> {
  const blob = await heldBlob(serving, hash);
  if (!blob) { return serving.channel.send(peer, hash, encodeBlobMissing()); }
  const chunks = splitBlob(blob);
  for (const [index, chunk] of chunks.entries()) { await serving.channel.send(peer, hash, encodeBlobChunk(index, chunks.length, chunk)); }
}
