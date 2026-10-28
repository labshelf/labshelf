// Declares the socket messages between a client and the relay and encodes and decodes their binary layout.

import { bytesToHex, joinBytes } from "../encoding/index.js";
import { RELAY_PROTOCOL_MAJOR, RELAY_PROTOCOL_MINOR } from "./protocolVersion.js";

// CONTRACT: documents/contracts/relay.md#socket-messages
export const MAX_RELAY_MESSAGE_BYTES = 1024 * 1024;

export const CLIENT_MESSAGE_TYPE = { put: 1, since: 2, snapshot: 3, forward: 4 } as const;

export const SERVER_MESSAGE_TYPE = {
  accepted: 16, stored: 17, rows: 18, forwarded: 19, peers: 20, joined: 21, left: 22, error: 23,
} as const;

/** Codes of a relay `error`; a newer minor may send others, which a client reads as a refusal. */
export const RELAY_ERROR_CODE = { malformed: 1, incompatibleVersion: 2, tooLarge: 3, staleSnapshot: 4 } as const;

/** A doc id as 32 lowercase hex characters; a frame is a whole share message, opaque to the relay. */
export type RelayClientMessage =
  | { type: "put"; doc: string; frame: Uint8Array }
  | { type: "since"; doc: string; cursor: number }
  | { type: "snapshot"; doc: string; covers: number; frame: Uint8Array }
  /** `to` 0 sends to every other peer. */
  | { type: "forward"; to: number; frame: Uint8Array };

export interface RelayRow { cursor: number; frame: Uint8Array }

export type RelayServerMessage =
  | { type: "accepted"; doc: string; cursor: number }
  | { type: "stored"; from: number; doc: string; cursor: number; frame: Uint8Array }
  | { type: "rows"; doc: string; more: boolean; snapshot?: { covers: number; frame: Uint8Array }; items: RelayRow[] }
  | { type: "forwarded"; from: number; frame: Uint8Array }
  | { type: "peers"; ids: number[] }
  | { type: "joined"; id: number }
  | { type: "left"; id: number }
  /** `doc` is absent when the error concerns no doc. */
  | { type: "error"; code: number; doc?: string };

export type RelayMessage = RelayClientMessage | RelayServerMessage;

/** `minor` is the sender's, so a Worker can keep types a client does not know away from it. */
export type RelayDecodeResult<T> =
  | { ok: true; minor: number; message: T }
  | { ok: false; error: "tooShort" | "tooLarge" | "malformed" }
  | { ok: false; error: "incompatibleVersion"; major: number }
  | { ok: false; error: "unknownType"; type: number };

const DOC_BYTES = 16;

/** A read past the end sets `failed` and yields a zero value, so a decoder checks once at the end. */
class ByteReader {
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

const HEADER_BYTES = 3;
const NO_DOC = "0".repeat(32);
/** A cursor or an id (4) and a frame length (4) with at least one byte. */
const MIN_ROW_BYTES = 9;

type FieldReader<T> = (read: ByteReader) => T;

const CLIENT_FIELDS: Record<number, FieldReader<RelayClientMessage>> = {
  [CLIENT_MESSAGE_TYPE.put]: (read) => ({ type: "put", doc: read.doc(), frame: read.frame() }),
  [CLIENT_MESSAGE_TYPE.since]: (read) => ({ type: "since", doc: read.doc(), cursor: read.u32() }),
  [CLIENT_MESSAGE_TYPE.snapshot]: (read) => ({ type: "snapshot", doc: read.doc(), covers: read.u32(), frame: read.frame() }),
  [CLIENT_MESSAGE_TYPE.forward]: (read) => ({ type: "forward", to: read.u32(), frame: read.frame() }),
};

const SERVER_FIELDS: Record<number, FieldReader<RelayServerMessage>> = {
  [SERVER_MESSAGE_TYPE.accepted]: (read) => ({ type: "accepted", doc: read.doc(), cursor: read.u32() }),
  [SERVER_MESSAGE_TYPE.stored]: (read) => ({ type: "stored", from: read.u32(), doc: read.doc(), cursor: read.u32(), frame: read.frame() }),
  [SERVER_MESSAGE_TYPE.rows]: readRows,
  [SERVER_MESSAGE_TYPE.forwarded]: (read) => ({ type: "forwarded", from: read.u32(), frame: read.frame() }),
  [SERVER_MESSAGE_TYPE.peers]: (read) => ({ type: "peers", ids: Array.from({ length: read.count(4) }, () => read.u32()) }),
  [SERVER_MESSAGE_TYPE.joined]: (read) => ({ type: "joined", id: read.u32() }),
  [SERVER_MESSAGE_TYPE.left]: (read) => ({ type: "left", id: read.u32() }),
  [SERVER_MESSAGE_TYPE.error]: (read) => {
    const code = read.u8();
    const doc = read.doc();
    return doc === NO_DOC ? { type: "error", code } : { type: "error", code, doc };
  },
};

function readRows(read: ByteReader): RelayServerMessage {
  const doc = read.doc();
  const flags = read.u8();
  const snapshot = flags & 2 ? { covers: read.u32(), frame: read.frame() } : undefined;
  const items: RelayRow[] = Array.from({ length: read.count(MIN_ROW_BYTES) }, () => ({ cursor: read.u32(), frame: read.frame() }));
  return { type: "rows", doc, more: (flags & 1) === 1, ...(snapshot ? { snapshot } : {}), items };
}

/** What the Worker reads; relay-to-client types count as unknown here. */
export const decodeClientMessage = (bytes: Uint8Array): RelayDecodeResult<RelayClientMessage> => decodeWith(bytes, CLIENT_FIELDS);

/** What a client reads; client-to-relay types count as unknown here. */
export const decodeServerMessage = (bytes: Uint8Array): RelayDecodeResult<RelayServerMessage> => decodeWith(bytes, SERVER_FIELDS);

// CONTRACT: documents/contracts/relay.md#versions
// Bytes after the known fields belong to a newer minor and are ignored.
function decodeWith<T>(bytes: Uint8Array, fields: Record<number, FieldReader<T>>): RelayDecodeResult<T> {
  if (bytes.length > MAX_RELAY_MESSAGE_BYTES) { return { ok: false, error: "tooLarge" }; }
  if (bytes.length < HEADER_BYTES) { return { ok: false, error: "tooShort" }; }
  if (bytes[0] !== RELAY_PROTOCOL_MAJOR) { return { ok: false, error: "incompatibleVersion", major: bytes[0]! }; }
  const type = bytes[2]!;
  const readFields = Object.hasOwn(fields, type) ? fields[type] : undefined;
  if (!readFields) { return { ok: false, error: "unknownType", type }; }
  const reader = new ByteReader(bytes, HEADER_BYTES);
  const message = readFields(reader);
  return reader.failed ? { ok: false, error: "malformed" } : { ok: true, minor: bytes[1]!, message };
}

const DOC_PATTERN = /^[0-9a-f]{32}$/;
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
    return joinBytes(this.parts);
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
