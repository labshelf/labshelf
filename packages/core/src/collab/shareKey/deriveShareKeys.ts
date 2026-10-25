// Derives the per-purpose keys and the relay token of a share from its share key.
import { bytesToBase64Url } from "../../encoding/index.js";
import { deriveAesShareKey, deriveBytes } from "./hkdf.js";
import type { DerivedShareKey } from "./hkdf.js";

export function deriveContentShareKey(shareKey: Uint8Array): Promise<DerivedShareKey> {
  return deriveAesShareKey(shareKey, "content");
}

export function derivePresenceShareKey(shareKey: Uint8Array): Promise<DerivedShareKey> {
  return deriveAesShareKey(shareKey, "awareness");
}

export async function deriveRelayToken(shareKey: Uint8Array): Promise<string> {
  return bytesToBase64Url(await deriveBytes(shareKey, "relay", 32));
}
