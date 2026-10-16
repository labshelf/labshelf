/** Reads the pixel width of a PNG from its IHDR chunk. */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];
const WIDTH_OFFSET = 16;

/** The width in pixels, or undefined when the bytes do not start with a PNG signature and an IHDR chunk. */
export function readPngWidth(bytes: Uint8Array): number | undefined {
  if (bytes.length < WIDTH_OFFSET + 4) { return undefined; }
  const isPng = SIGNATURE.every((byte, i) => bytes[i] === byte) && IHDR.every((byte, i) => bytes[12 + i] === byte);
  return isPng ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(WIDTH_OFFSET) : undefined;
}
