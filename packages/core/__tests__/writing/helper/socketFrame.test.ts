/** Verifies the helper socket framing: length-prefixed JSON envelope followed by raw payload bytes. */
import { decodeSocketMessage, encodeSocketMessage } from "../../../src/writing/helper/socketFrame";

const envelope = { v: 2, id: "7", type: "compile", projectId: "thesis" };

describe("socket frame", () => {
  it("lays out a 4-byte little-endian JSON length, the JSON, then the payload", () => {
    const payload = new Uint8Array([1, 2, 3]);
    const bytes = encodeSocketMessage(envelope, payload);
    const json = new TextEncoder().encode(JSON.stringify(envelope));
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true)).toBe(json.length);
    expect(Array.from(bytes.subarray(4 + json.length))).toEqual([1, 2, 3]);
  });

  it("round-trips an envelope with and without a payload", () => {
    const withPayload = decodeSocketMessage(encodeSocketMessage(envelope, new Uint8Array([9, 8])));
    expect(withPayload.envelope).toEqual(envelope);
    expect(Array.from(withPayload.payload)).toEqual([9, 8]);
    const bare = decodeSocketMessage(encodeSocketMessage(envelope));
    expect(bare.envelope).toEqual(envelope);
    expect(bare.payload.length).toBe(0);
  });

  it("keeps non-ASCII text in the envelope", () => {
    expect(decodeSocketMessage(encodeSocketMessage({ ...envelope, text: "é漢" })).envelope).toEqual({ ...envelope, text: "é漢" });
  });

  it("rejects a message shorter than its length prefix", () => {
    expect(() => decodeSocketMessage(new Uint8Array([1, 0]))).toThrow();
    const bytes = encodeSocketMessage(envelope);
    expect(() => decodeSocketMessage(bytes.subarray(0, bytes.length - 2))).toThrow();
  });

  it("rejects an envelope that is not JSON", () => {
    const bytes = new Uint8Array([3, 0, 0, 0, 0x7b, 0x6e, 0x6f]);
    expect(() => decodeSocketMessage(bytes)).toThrow();
  });

  it("rejects a message over 16 MiB on decode and on encode", () => {
    const big = new Uint8Array(16 * 1024 * 1024 + 1);
    expect(() => encodeSocketMessage(envelope, big)).toThrow();
    const raw = new Uint8Array(big.length);
    new DataView(raw.buffer).setUint32(0, 2, true);
    expect(() => decodeSocketMessage(raw)).toThrow();
  });
});
