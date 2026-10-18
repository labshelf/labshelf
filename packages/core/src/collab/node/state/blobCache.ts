// Keeps the blobs of a share on this device by SHA-256, so they are served to peers and survive restarts.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { writeFileAtomic } from "../../../library/node/index.js";
import { sha256Hex } from "../../../hash/index.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

export class BlobCache {
  constructor(private readonly dir: string) {}

  /** The bytes stored under `hash`; undefined for a hash not held or not a SHA-256 hex, which no file name can come from. */
  async get(hash: string): Promise<Uint8Array | undefined> {
    if (!HASH_PATTERN.test(hash)) { return undefined; }
    try {
      return new Uint8Array(await fs.readFile(path.join(this.dir, hash)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
      throw error;
    }
  }

  /** Stores the bytes and returns their hash; bytes already held are not written again. */
  async put(bytes: Uint8Array): Promise<string> {
    const hash = await sha256Hex(bytes);
    const file = path.join(this.dir, hash);
    const held = await fs.stat(file).then(() => true, () => false);
    if (!held) { await writeFileAtomic(file, bytes); }
    return hash;
  }
}
