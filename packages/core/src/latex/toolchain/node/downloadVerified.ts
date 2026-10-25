// Downloads a file into memory and checks its SHA-256 before anything is written or run.
import { createHash } from "node:crypto";
import type { FetchLike } from "../../../ports/index.js";

/** The downloaded bytes; throws when the request fails, is aborted or the hash differs from `sha256`. */
export async function downloadVerified(
  url: string,
  sha256: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<Buffer> {
  const response = await fetchImpl(url, signal ? { signal } : {});
  if (!response.ok) { throw new Error(`Download failed with HTTP ${response.status} from ${url}`); }
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) {
    throw new Error(`Checksum mismatch for ${url}: expected ${sha256}, got ${actual}`);
  }
  return bytes;
}
