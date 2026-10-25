// Encodes and decodes one helper socket message: a 4-byte little-endian JSON length, the UTF-8 JSON envelope, then raw payload bytes.
// CONTRACT: documents/contracts/helper.md#transport

import { MAX_SOCKET_MESSAGE_BYTES } from "./helperMessages.js";

export interface SocketMessage {
  envelope: Record<string, unknown>;
  payload: Uint8Array;
}

const LENGTH_BYTES = 4;

export function encodeSocketMessage(envelope: object, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(envelope));
  const total = LENGTH_BYTES + json.length + payload.length;
  if (total > MAX_SOCKET_MESSAGE_BYTES) {
    throw new Error(`Socket message of ${total} bytes is over the 16 MiB limit`);
  }
  const bytes = new Uint8Array(total);
  new DataView(bytes.buffer).setUint32(0, json.length, true);
  bytes.set(json, LENGTH_BYTES);
  bytes.set(payload, LENGTH_BYTES + json.length);
  return bytes;
}

export function decodeSocketMessage(bytes: Uint8Array): SocketMessage {
  if (bytes.length > MAX_SOCKET_MESSAGE_BYTES) {
    throw new Error(`Socket message of ${bytes.length} bytes is over the 16 MiB limit`);
  }
  if (bytes.length < LENGTH_BYTES) {
    throw new Error(`Socket message of ${bytes.length} bytes is shorter than its length prefix`);
  }
  const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const jsonEnd = LENGTH_BYTES + jsonLength;
  if (jsonEnd > bytes.length) {
    throw new Error(`Socket message declares a ${jsonLength}-byte envelope but holds ${bytes.length - LENGTH_BYTES} bytes`);
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(LENGTH_BYTES, jsonEnd));
  const envelope: unknown = JSON.parse(text);
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    throw new Error("Socket message envelope is not a JSON object");
  }
  return { envelope: envelope as Record<string, unknown>, payload: bytes.subarray(jsonEnd) };
}
