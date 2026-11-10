/** The Mirror's row format for a compiled project PDF: the file split in parts of OUTPUT_PART_BYTES raw bytes, each a text
 * row `<file>/<n>` whose value is a JSON MirrorOutputPart, so every relay request stays under 1 MiB. A reader groups the rows
 * by dropping the last segment, checks every part has the same hash and parts count, decodes and concatenates. */
import { base64ToBytes, bytesToBase64, isCanonicalBase64 } from "../encoding/index.js";
import { deriveSha256Hex } from "../hash/index.js";
import { parseJsonObject } from "../json/index.js";

/** Raw bytes per part: base64 makes it about 934 KiB, under the relay's 1 MiB request with its envelope. */
export const OUTPUT_PART_BYTES = 700 * 1024;
/** A compiled output over this many raw bytes is not mirrored. */
export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export interface MirrorOutputPart {
  version: 1;
  /** SHA-256 hex of the whole file. */
  hash: string;
  part: number;
  parts: number;
  /** Byte length of the whole file. */
  size: number;
  /** Canonical padded base64 of this part's bytes. */
  data: string;
}

export interface MirrorOutput { hash: string; size: number; parts: number; part(n: number): string }

/** The parts of one output file; `part(n)` builds the row value of part n on demand. An empty file has one empty part. */
export async function encodeMirrorOutput(bytes: Uint8Array): Promise<MirrorOutput> {
  const hash = await deriveSha256Hex(bytes);
  const size = bytes.byteLength;
  const parts = Math.max(1, Math.ceil(size / OUTPUT_PART_BYTES));
  return {
    hash, size, parts,
    part: (n) => {
      const data = bytesToBase64(bytes.subarray(n * OUTPUT_PART_BYTES, (n + 1) * OUTPUT_PART_BYTES));
      const value: MirrorOutputPart = { version: 1, hash, part: n, parts, size, data };
      return JSON.stringify(value);
    },
  };
}

/** The row path of part n of the output at `file`. */
export function mirrorOutputPartPath(file: string, part: number): string {
  return `${file}/${part}`;
}

/** One part row's value, or undefined when it is not a well-formed part. */
export function parseMirrorOutputPart(text: string): MirrorOutputPart | undefined {
  const value = parseJsonObject(text);
  if (!value || value["version"] !== 1) { return undefined; }
  const { hash, part, parts, size, data } = value;
  if (typeof hash !== "string" || typeof data !== "string" || !isCanonicalBase64(data)) { return undefined; }
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(parts) || !Number.isSafeInteger(size)) { return undefined; }
  const [n, count, total] = [part as number, parts as number, size as number];
  if (n < 0 || count < 1 || n >= count || total < 0) { return undefined; }
  return { version: 1, hash, part: n, parts: count, size: total, data };
}

/** The whole file from its part values in any order; undefined when a part is missing, repeated or disagrees, or the bytes do not match the hash. */
export async function decodeMirrorOutput(values: string[]): Promise<Uint8Array | undefined> {
  const parts = values.map(parseMirrorOutputPart);
  const first = parts[0];
  if (!first || parts.length !== first.parts) { return undefined; }
  const ordered: (MirrorOutputPart | undefined)[] = new Array<MirrorOutputPart | undefined>(first.parts).fill(undefined);
  for (const part of parts) {
    if (!part || part.hash !== first.hash || part.parts !== first.parts || part.size !== first.size || ordered[part.part]) { return undefined; }
    ordered[part.part] = part;
  }
  const bytes = new Uint8Array(first.size);
  let offset = 0;
  for (const part of ordered) {
    const chunk = base64ToBytes(part!.data);
    if (offset + chunk.byteLength > bytes.byteLength) { return undefined; }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== first.size || (await deriveSha256Hex(bytes)) !== first.hash) { return undefined; }
  return bytes;
}
