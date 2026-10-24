// Reads the fields of a socket message from untrusted bytes without ever reading past them.

import { bytesToHex } from "../../encoding/index.js";

const DOC_BYTES = 16;

/** A read past the end sets `failed` and yields a zero value, so a decoder checks once at the end. */
export class ByteReader {
  failed = false;
  private offset: number;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array, offset: number) {
    this.offset = offset;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number { return this.bytes.length - this.offset; }

  u8(): number {
    if (!this.take(1)) { return 0; }
    return this.bytes[this.offset - 1]!;
  }

  u32(): number {
    if (!this.take(4)) { return 0; }
    return this.view.getUint32(this.offset - 4);
  }

  doc(): string {
    if (!this.take(DOC_BYTES)) { return ""; }
    return bytesToHex(this.bytes.subarray(this.offset - DOC_BYTES, this.offset));
  }

  /** A 4-byte length and that many bytes, at least one. */
  frame(): Uint8Array {
    const length = this.u32();
    if (length === 0) { this.failed = true; }
    if (this.failed || !this.take(length)) { return new Uint8Array(); }
    return this.bytes.slice(this.offset - length, this.offset);
  }

  /** A 4-byte count, refused when `minBytesEach` bytes per item cannot follow. */
  count(minBytesEach: number): number {
    const count = this.u32();
    if (count * minBytesEach > this.remaining) { this.failed = true; return 0; }
    return count;
  }

  private take(length: number): boolean {
    if (this.failed || length > this.remaining) { this.failed = true; return false; }
    this.offset += length;
    return true;
  }
}
