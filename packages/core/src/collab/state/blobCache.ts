// Keeps the blobs of a share on this device by SHA-256, handing out only bytes that still match their hash.
import { sha256Hex } from "../../hash/index.js";
import type { ILogger } from "../../ports/index.js";
import type { CollabStateStorage } from "./collabStateStorage.js";

const LOG_MODULE = "collab.state";
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export class BlobCache {
  constructor(private readonly storage: CollabStateStorage, private readonly logger: ILogger) {}

  /** The bytes stored under `hash`; undefined for a hash not held, a corrupt copy, or a string that is no SHA-256 hex. */
  async get(hash: string): Promise<Uint8Array | undefined> {
    if (!HASH_PATTERN.test(hash)) { return undefined; }
    const bytes = await this.storage.readBlob(hash);
    if (!bytes) { return undefined; }
    if (await sha256Hex(bytes) === hash) { return bytes; }
    await this.logger.log("WARN", LOG_MODULE, "Ignored a stored blob whose bytes do not match its hash", { hash, bytes: bytes.length });
    return undefined;
  }

  /** Stores the bytes and returns their hash; a sound copy already held is not written again. */
  async put(bytes: Uint8Array): Promise<string> {
    const hash = await sha256Hex(bytes);
    if (await this.get(hash) === undefined) { await this.storage.writeBlob(hash, bytes); }
    return hash;
  }
}
