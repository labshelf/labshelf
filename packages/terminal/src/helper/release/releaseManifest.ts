// Fetches the release manifest and returns this platform's asset only when the manifest's Ed25519 signature verifies.
import { createPublicKey, verify } from "node:crypto";

import { isRecord } from "@labshelf/core";
import type { FetchLike } from "@labshelf/core/helper/node";

export const LATEST_MANIFEST_URL = "https://github.com/labshelf/labshelf/releases/latest/download/latest.json";

export interface ReleaseAsset {
  version: string;
  url: string;
  sha256: string;
}

async function fetchBytes(fetchImpl: FetchLike, url: string): Promise<Buffer> {
  const response = await fetchImpl(url);
  if (!response.ok) { throw new Error(`Update lookup failed with HTTP ${response.status} from ${url}`); }
  return Buffer.from(await response.arrayBuffer());
}

function verifySignature(manifest: Buffer, signature: Buffer, publicKey: string): void {
  const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
  const signatureBytes = Buffer.from(signature.toString("utf8").trim(), "base64");
  if (!verify(null, manifest, key, signatureBytes)) { throw new Error("latest.json signature does not verify"); }
}

// TRAP: only call this on bytes whose signature verified; the shape check guards against a release bug, not an attacker.
function assetFor(manifest: unknown, assetKey: string): ReleaseAsset {
  const version = isRecord(manifest) ? manifest["version"] : undefined;
  const assets = isRecord(manifest) ? manifest["assets"] : undefined;
  const asset = isRecord(assets) ? assets[assetKey] : undefined;
  const url = isRecord(asset) ? asset["url"] : undefined;
  const sha256 = isRecord(asset) ? asset["sha256"] : undefined;
  if (typeof version !== "string") { throw new Error("latest.json has no version"); }
  if (typeof url !== "string" || typeof sha256 !== "string") { throw new Error(`latest.json has no asset for ${assetKey}`); }
  return { version, url, sha256 };
}

/** `assetKey` is `<process.platform>-<process.arch>`, for example `darwin-arm64` or `win32-x64`. */
export async function fetchSignedRelease(fetchImpl: FetchLike, publicKey: string, assetKey: string): Promise<ReleaseAsset> {
  const manifest = await fetchBytes(fetchImpl, LATEST_MANIFEST_URL);
  verifySignature(manifest, await fetchBytes(fetchImpl, `${LATEST_MANIFEST_URL}.sig`), publicKey);
  return assetFor(JSON.parse(manifest.toString("utf8")) as unknown, assetKey);
}
