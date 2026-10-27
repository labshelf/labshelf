// Encodes frames the way a browser does, for tests that feed the helper's reader and loop.
import * as os from "node:os";

export function encodeFrame(value: unknown): Buffer {
  const payload = Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  if (os.endianness() === "LE") { header.writeUInt32LE(payload.length); } else { header.writeUInt32BE(payload.length); }
  return Buffer.concat([header, payload]);
}

export function decodeFrames(bytes: Buffer): unknown[] {
  const frames: unknown[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const length = os.endianness() === "LE" ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    frames.push(JSON.parse(bytes.subarray(offset + 4, offset + 4 + length).toString("utf8")));
    offset += 4 + length;
  }
  return frames;
}
