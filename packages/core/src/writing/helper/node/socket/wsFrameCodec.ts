// Reads masked RFC 6455 client frames into whole binary messages and writes unmasked server frames.
// CONTRACT: documents/contracts/helper.md#transport

export const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

export type FrameEvent =
  | { kind: "message"; data: Buffer }
  | { kind: "close"; data: Buffer }
  | { kind: "ping"; data: Buffer }
  | { kind: "pong" }
  | { kind: "violation"; reason: string; status: number };

interface FrameHeader { fin: boolean; opcode: number; length: number; headerBytes: number; mask: Buffer }

export function encodeServerFrame(opcode: number, data: Uint8Array = new Uint8Array(0)): Buffer {
  const length = data.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header.writeUInt16BE(length, 2);
    header[1] = 126;
  } else {
    header = Buffer.alloc(10);
    header.writeBigUInt64BE(BigInt(length), 2);
    header[1] = 127;
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

function readHeader(buffer: Buffer): FrameHeader | undefined {
  if (buffer.length < 2) { return undefined; }
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) { return undefined; }
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) { return undefined; }
    const declared = buffer.readBigUInt64BE(2);
    length = declared > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(declared);
    offset = 10;
  }
  const masked = (buffer[1]! & 0x80) !== 0;
  const maskBytes = masked ? 4 : 0;
  if (buffer.length < offset + maskBytes) { return undefined; }
  return {
    fin: (buffer[0]! & 0x80) !== 0, opcode: buffer[0]! & 0x0f, length,
    headerBytes: offset + maskBytes, mask: masked ? buffer.subarray(offset, offset + 4) : Buffer.alloc(0),
  };
}

function unmask(data: Buffer, mask: Buffer): Buffer {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 1) { out[i] = out[i]! ^ mask[i % 4]!; }
  return out;
}

/** Collects TCP chunks and yields one event per complete frame or reassembled message. */
export class FrameReader {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private fragmenting = false;

  constructor(private readonly maxMessageBytes: number) {}

  push(chunk: Buffer): FrameEvent[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const events: FrameEvent[] = [];
    for (;;) {
      const header = readHeader(this.buffer);
      if (!header) { return events; }
      const violation = this.check(header);
      if (violation) { events.push(violation); return events; }
      const end = header.headerBytes + header.length;
      if (this.buffer.length < end) { return events; }
      const data = unmask(this.buffer.subarray(header.headerBytes, end), header.mask);
      this.buffer = this.buffer.subarray(end);
      const event = this.accept(header, data);
      if (event) { events.push(event); }
    }
  }

  // INVARIANT: runs on the header alone, so an oversized frame is refused before its body is buffered.
  private check(header: FrameHeader): FrameEvent | undefined {
    const violation = (reason: string, status = 1002): FrameEvent => ({ kind: "violation", reason, status });
    if (header.mask.length === 0) { return violation("client frame is not masked"); }
    if (header.opcode === OPCODE.text) { return violation("text frames are refused", 1003); }
    if (header.opcode >= 0x8) {
      if (!header.fin || header.length > 125) { return violation("control frame is fragmented or over 125 bytes"); }
      if (header.opcode > OPCODE.pong) { return violation(`unknown opcode ${header.opcode}`); }
      return undefined;
    }
    if (header.opcode !== OPCODE.binary && header.opcode !== OPCODE.continuation) { return violation(`unknown opcode ${header.opcode}`); }
    if ((header.opcode === OPCODE.continuation) !== this.fragmenting) { return violation("continuation frame out of sequence"); }
    if (this.fragmentBytes + header.length > this.maxMessageBytes) {
      return violation(`message over the 16 MiB limit (${this.fragmentBytes + header.length} bytes declared)`, 1009);
    }
    return undefined;
  }

  private accept(header: FrameHeader, data: Buffer): FrameEvent | undefined {
    if (header.opcode === OPCODE.close) { return { kind: "close", data }; }
    if (header.opcode === OPCODE.ping) { return { kind: "ping", data }; }
    if (header.opcode === OPCODE.pong) { return { kind: "pong" }; }
    this.fragments.push(data);
    this.fragmentBytes += data.length;
    this.fragmenting = !header.fin;
    if (!header.fin) { return undefined; }
    const message = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentBytes = 0;
    return { kind: "message", data: message };
  }
}
