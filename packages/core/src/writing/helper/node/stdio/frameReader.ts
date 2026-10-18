// Splits a byte stream into native-messaging frames, whatever way the chunks fall.
import * as os from "node:os";

const HEADER_BYTES = 4;
// The page's largest frame is a sync of 5000 files, well under this; a bigger length means a corrupt stream.
const MAX_INCOMING_FRAME_BYTES = 4 * 1024 * 1024;

export interface ReadFramesOptions {
  maxFrameBytes?: number;
  /** Called at EOF with the number of bytes of a frame that never completed. */
  onTruncated?: (bytes: number) => void;
}

function readLength(buffer: Buffer): number {
  return os.endianness() === "LE" ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
}

/**
 * Yields each frame's JSON payload. Throws when a frame announces more than `maxFrameBytes`, because the stream cannot
 * be resynchronised after that.
 */
export async function* readFrames(input: AsyncIterable<Uint8Array>, options: ReadFramesOptions = {}): AsyncGenerator<Buffer> {
  const maxFrameBytes = options.maxFrameBytes ?? MAX_INCOMING_FRAME_BYTES;
  let pending = Buffer.alloc(0);
  for await (const chunk of input) {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    while (pending.length >= HEADER_BYTES) {
      const length = readLength(pending);
      if (length > maxFrameBytes) { throw new Error(`Incoming frame of ${length} bytes exceeds the ${maxFrameBytes}-byte limit`); }
      if (pending.length < HEADER_BYTES + length) { break; }
      yield pending.subarray(HEADER_BYTES, HEADER_BYTES + length);
      pending = pending.subarray(HEADER_BYTES + length);
    }
  }
  if (pending.length > 0) { options.onTruncated?.(pending.length); }
}
