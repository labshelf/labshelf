/** Splits bytes into base64 protocol chunks and reassembles them, refusing gaps, duplicates and count changes. */
// CONTRACT: documents/contracts/helper.md#chunks

import { CHUNK_MAX_BYTES, MAX_CHUNK_COUNT, type HelperChunk } from "./helperMessages.js";

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_DATA_LENGTH = Math.ceil(CHUNK_MAX_BYTES / 3) * 4;
// PLATFORM: String.fromCharCode spreads its arguments on the stack, so large buffers convert in slices.
const CHARS_PER_CALL = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHARS_PER_CALL) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHARS_PER_CALL));
  }
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) { bytes[i] = binary.charCodeAt(i); }
  return bytes;
}

/** Why chunk data is refused: "limit" past CHUNK_MAX_BYTES decoded, "invalid" when not canonical base64; undefined when it is fine. */
export function chunkDataProblem(data: string): "limit" | "invalid" | undefined {
  if (data.length > MAX_DATA_LENGTH) { return "limit"; }
  if (!BASE64.test(data)) { return "invalid"; }
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
    data: toBase64(bytes.subarray(index * CHUNK_MAX_BYTES, (index + 1) * CHUNK_MAX_BYTES)),
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
    this.parts.push(fromBase64(chunk.data));
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
