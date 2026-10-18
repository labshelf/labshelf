/** Frames bridge messages as Native Messaging does: a 4-byte length, then UTF-8 JSON. */
import { BridgeError } from "./bridgeError.js";
import { BROWSER_MESSAGE_LIMIT, HOST_MESSAGE_LIMIT } from "./protocol.js";

// CONTRACT: documents/contracts/bridge.md#framing
const HEADER_BYTES = 4;

// PLATFORM: Native Messaging uses native byte order; every platform the browsers ship on is little-endian.
const LITTLE_ENDIAN = true;

export function encodeFrame(message: unknown, maxBytes = HOST_MESSAGE_LIMIT): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message));
  if (body.length > maxBytes) {
    throw new BridgeError("protocol", `Message of ${body.length} bytes exceeds the ${maxBytes}-byte limit`);
  }
  const frame = new Uint8Array(HEADER_BYTES + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, LITTLE_ENDIAN);
  frame.set(body, HEADER_BYTES);
  return frame;
}

export interface DecodeResult {
  messages: unknown[];
  /** Set by the first bad frame; the decoder returns nothing afterwards because the stream has lost its frame boundaries. */
  error?: BridgeError;
}

/** Collects bytes from a stream and yields each complete message, however the bytes were split. */
export class FrameDecoder {
  /** Received bytes not yet consumed; joined only once a whole header or body is buffered. */
  private parts: Uint8Array[] = [];
  private buffered = 0;
  /** The announced body length once its header is read. */
  private bodyLength: number | undefined;
  private broken = false;
  private readonly text = new TextDecoder("utf-8", { fatal: true });

  constructor(private readonly maxBytes = BROWSER_MESSAGE_LIMIT) {}

  push(bytes: Uint8Array): DecodeResult {
    if (this.broken) return { messages: [] };
    this.parts.push(bytes);
    this.buffered += bytes.length;
    const messages: unknown[] = [];
    try {
      for (;;) {
        if (this.bodyLength === undefined) {
          if (this.buffered < HEADER_BYTES) break;
          this.bodyLength = this.readHeader(this.take(HEADER_BYTES));
        }
        if (this.buffered < this.bodyLength) break;
        const body = this.take(this.bodyLength);
        this.bodyLength = undefined;
        messages.push(this.parse(body));
      }
    } catch (error) {
      this.broken = true;
      this.parts = [];
      this.buffered = 0;
      return { messages, error: error as BridgeError };
    }
    return { messages };
  }

  private readHeader(header: Uint8Array): number {
    const length = new DataView(header.buffer, header.byteOffset, HEADER_BYTES).getUint32(0, LITTLE_ENDIAN);
    if (length > this.maxBytes) {
      throw new BridgeError("protocol", `Frame of ${length} bytes exceeds the ${this.maxBytes}-byte limit`);
    }
    return length;
  }

  /** Removes the first `count` buffered bytes, copying only when they span several parts. */
  private take(count: number): Uint8Array {
    this.buffered -= count;
    const first = this.parts[0];
    if (first && first.length >= count) {
      if (first.length === count) this.parts.shift();
      else this.parts[0] = first.subarray(count);
      return first.subarray(0, count);
    }
    const joined = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const part = this.parts[0] as Uint8Array;
      const used = Math.min(part.length, count - filled);
      joined.set(part.subarray(0, used), filled);
      filled += used;
      if (used === part.length) this.parts.shift();
      else this.parts[0] = part.subarray(used);
    }
    return joined;
  }

  private parse(body: Uint8Array): unknown {
    try {
      return JSON.parse(this.text.decode(body));
    } catch (error) {
      throw new BridgeError("protocol", `Frame is not UTF-8 JSON: ${(error as Error).message}`);
    }
  }
}
