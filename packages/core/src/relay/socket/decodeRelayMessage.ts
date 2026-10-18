// Decodes untrusted socket bytes into a client or a relay message, returning a typed error instead of throwing.

import { RELAY_PROTOCOL_MAJOR } from "../protocolVersion.js";
import { ByteReader } from "./byteReader.js";
import {
  CLIENT_MESSAGE_TYPE, MAX_RELAY_MESSAGE_BYTES, SERVER_MESSAGE_TYPE,
  type RelayClientMessage, type RelayDecodeResult, type RelayRow, type RelayServerMessage,
} from "./socketMessages.js";

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
