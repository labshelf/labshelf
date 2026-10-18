/** Splits file bytes into the base64 chunks the bridge carries. */
import { bytesToBase64 } from "../encoding/index.js";
import { BRIDGE_CHUNK_BYTES } from "./protocol.js";

// CONTRACT: documents/contracts/bridge.md#file-transfer
export function splitFileChunks(bytes: Uint8Array): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BRIDGE_CHUNK_BYTES) {
    chunks.push(bytesToBase64(bytes.subarray(offset, offset + BRIDGE_CHUNK_BYTES)));
  }
  return chunks;
}
