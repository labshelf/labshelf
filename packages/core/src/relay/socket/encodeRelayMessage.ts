// Encodes a socket message of either direction into the binary layout of the relay protocol.

import { RELAY_PROTOCOL_MAJOR, RELAY_PROTOCOL_MINOR } from "../protocolVersion.js";
import { CLIENT_MESSAGE_TYPE, SERVER_MESSAGE_TYPE, type RelayMessage } from "./socketMessages.js";

const DOC_PATTERN = /^[0-9a-f]{32}$/;
const NO_DOC = "0".repeat(32);

/** Collects big-endian fields; throws RangeError on values the caller should never produce. */
class ByteWriter {
  private readonly parts: Uint8Array[] = [];

  u8(value: number): this { return this.push(Uint8Array.of(checkRange(value, 0xff))); }

  u32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, checkRange(value, 0xffffffff));
    return this.push(bytes);
  }

  doc(hex: string): this {
    if (!DOC_PATTERN.test(hex)) { throw new RangeError(`relay doc id must be 32 lowercase hex characters, got "${hex}"`); }
    return this.push(Uint8Array.from({ length: 16 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16)));
  }

  frame(bytes: Uint8Array): this {
    if (bytes.length === 0) { throw new RangeError("relay frame must not be empty"); }
    return this.u32(bytes.length).push(bytes);
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of this.parts) { out.set(part, offset); offset += part.length; }
    return out;
  }

  private push(bytes: Uint8Array): this { this.parts.push(bytes); return this; }
}

function checkRange(value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) { throw new RangeError(`relay field ${value} is outside 0 to ${max}`); }
  return value;
}

const TYPE_BYTE: Record<RelayMessage["type"], number> = { ...CLIENT_MESSAGE_TYPE, ...SERVER_MESSAGE_TYPE };

export function encodeRelayMessage(message: RelayMessage): Uint8Array {
  const out = new ByteWriter().u8(RELAY_PROTOCOL_MAJOR).u8(RELAY_PROTOCOL_MINOR).u8(TYPE_BYTE[message.type]);
  writeFields(out, message);
  return out.bytes();
}

function writeFields(out: ByteWriter, message: RelayMessage): void {
  switch (message.type) {
    case "put": out.doc(message.doc).frame(message.frame); return;
    case "since": out.doc(message.doc).u32(message.cursor); return;
    case "snapshot": out.doc(message.doc).u32(message.covers).frame(message.frame); return;
    case "forward": out.u32(message.to).frame(message.frame); return;
    case "accepted": out.doc(message.doc).u32(message.cursor); return;
    case "stored": out.u32(message.from).doc(message.doc).u32(message.cursor).frame(message.frame); return;
    case "rows": writeRows(out, message); return;
    case "forwarded": out.u32(message.from).frame(message.frame); return;
    case "peers": out.u32(message.ids.length); message.ids.forEach((id) => out.u32(id)); return;
    case "joined": case "left": out.u32(message.id); return;
    case "error": out.u8(message.code).doc(message.doc ?? NO_DOC); return;
  }
}

function writeRows(out: ByteWriter, message: Extract<RelayMessage, { type: "rows" }>): void {
  out.doc(message.doc).u8((message.more ? 1 : 0) | (message.snapshot ? 2 : 0));
  if (message.snapshot) { out.u32(message.snapshot.covers).frame(message.snapshot.frame); }
  out.u32(message.items.length);
  for (const item of message.items) { out.u32(item.cursor).frame(item.frame); }
}
