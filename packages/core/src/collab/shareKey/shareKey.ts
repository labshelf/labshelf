// Generates, identifies and rotates the random key that a share's members hold.
import { bytesToHex } from "../../encoding/index.js";
import { deriveBytes } from "./hkdf.js";

export const SHARE_KEY_BYTES = 16;

export interface ShareSecret {
  shareKey: Uint8Array;
  shareId: string;
}

export function createShareKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SHARE_KEY_BYTES));
}

/** The share id names the share publicly without revealing the key. */
export async function deriveShareId(shareKey: Uint8Array): Promise<string> {
  return bytesToHex(await deriveBytes(shareKey, "share-id", 16));
}

/** Frames sealed under `previous` stay readable only to whoever keeps it. */
export async function createNextShareKey(current: ShareSecret): Promise<{ previous: ShareSecret; next: ShareSecret }> {
  const shareKey = createShareKey();
  return { previous: current, next: { shareKey, shareId: await deriveShareId(shareKey) } };
}
