// Derives the per-purpose keys and the relay token of a share from its share key.
import { bytesToBase64Url } from "../../encoding/index.js";
import { deriveAesKey, deriveBytes } from "./hkdf.js";
import type { WebCryptoKey } from "./hkdf.js";

export function deriveContentKey(shareKey: Uint8Array): Promise<WebCryptoKey> {
  return deriveAesKey(shareKey, "content");
}

export function deriveAwarenessKey(shareKey: Uint8Array): Promise<WebCryptoKey> {
  return deriveAesKey(shareKey, "awareness");
}

export async function deriveRelayToken(shareKey: Uint8Array): Promise<string> {
  return bytesToBase64Url(await deriveBytes(shareKey, "relay", 32));
}
