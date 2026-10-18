// Derives the per-purpose keys and credentials of a share from its share key.
import { bytesToBase64Url, bytesToHex } from "../../encoding/index.js";
import { deriveAesKey, deriveBytes } from "./hkdf.js";
import type { WebCryptoKey } from "./hkdf.js";

export interface RoomCredentials {
  roomId: string;
  password: string;
}

export function deriveContentKey(shareKey: Uint8Array): Promise<WebCryptoKey> {
  return deriveAesKey(shareKey, "content");
}

export function deriveAwarenessKey(shareKey: Uint8Array): Promise<WebCryptoKey> {
  return deriveAesKey(shareKey, "awareness");
}

/** Splits one derived secret so the room id peers announce reveals nothing about the room password. */
export async function deriveRoomCredentials(shareKey: Uint8Array): Promise<RoomCredentials> {
  const bytes = await deriveBytes(shareKey, "room", 32);
  return { roomId: bytesToHex(bytes.subarray(0, 16)), password: bytesToBase64Url(bytes.subarray(16)) };
}

export async function deriveRelayToken(shareKey: Uint8Array): Promise<string> {
  return bytesToBase64Url(await deriveBytes(shareKey, "relay", 32));
}
