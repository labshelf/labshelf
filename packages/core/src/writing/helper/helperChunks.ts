/** Splits bytes into base64 protocol chunks and reassembles them, refusing gaps, duplicates and count changes. */
// CONTRACT: documents/contracts/helper.md#chunks

import { base64ToBytes, bytesToBase64, isCanonicalBase64 } from "../../encoding/index.js";
import { CHUNK_MAX_BYTES, MAX_CHUNK_COUNT, type HelperChunk } from "./helperMessages.js";

const MAX_DATA_LENGTH = Math.ceil(CHUNK_MAX_BYTES / 3) * 4;
/** Why chunk data is refused: "limit" past CHUNK_MAX_BYTES decoded, "invalid" when not canonical base64; undefined when it is fine. */
export function chunkDataProblem(data: string): "limit" | "invalid" | undefined {
  if (data.length > MAX_DATA_LENGTH) { return "limit"; }
  if (!isCanonicalBase64(data)) { return "invalid"; }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding > CHUNK_MAX_BYTES ? "limit" : undefined;
}

export function isChunkShape(index: number, count: number): boolean {
  return Number.isInteger(index) && Number.isInteger(count) && count >= 1 && count <= MAX_CHUNK_COUNT && index >= 0 && index < count;
}

/** The chunks of `bytes` in order; an empty buffer is one empty chunk so the receiver still sees an end. */
export function chunkBytes(bytes: Uint8Array): HelperChunk[] {
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK_MAX_BYTES));
  return Array.from({ length: count }, (_, index) => ({
    index,
    count,
    data: bytesToBase64(bytes.subarray(index * CHUNK_MAX_BYTES, (index + 1) * CHUNK_MAX_BYTES)),
  }));
}

export type ChunkRejectionReason = "gap" | "duplicate" | "count-changed" | "invalid-chunk";
export type ChunkAddResult =
  | { status: "partial" }
  | { status: "complete"; bytes: Uint8Array }
  | { status: "rejected"; reason: ChunkRejectionReason };

/** Collects the chunks of one stream, which must arrive in index order. */
export class ChunkAssembler {
  private readonly parts: Uint8Array[] = [];
  private count: number | undefined;
  private complete = false;

  add(chunk: HelperChunk): ChunkAddResult {
    if (!isChunkShape(chunk.index, chunk.count) || chunkDataProblem(chunk.data) !== undefined) { return { status: "rejected", reason: "invalid-chunk" }; }
    if (this.count !== undefined && chunk.count !== this.count) { return { status: "rejected", reason: "count-changed" }; }
    if (this.complete || chunk.index < this.parts.length) { return { status: "rejected", reason: "duplicate" }; }
    if (chunk.index > this.parts.length) { return { status: "rejected", reason: "gap" }; }
    this.count = chunk.count;
    this.parts.push(base64ToBytes(chunk.data));
    if (this.parts.length < chunk.count) { return { status: "partial" }; }
    this.complete = true;
    return { status: "complete", bytes: concat(this.parts) };
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
