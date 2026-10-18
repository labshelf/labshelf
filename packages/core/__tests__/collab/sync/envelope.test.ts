/** Pins the clear envelope header and the opaque doc id every share message travels under. */
import {
  decodeEnvelope, deriveDocId, encodeEnvelope, ENVELOPE_HEADER_BYTES, EXTENSION_KIND_MIN, MESSAGE_KIND, ENVELOPE_VERSION,
} from "../../../src/collab/sync/index";

describe("envelope", () => {
  it("pins the protocol version and message kinds", () => {
    expect(ENVELOPE_VERSION).toBe(1);
    expect(MESSAGE_KIND).toEqual({ syncStep1: 1, syncStep2: 2, update: 3, ack: 4 });
    expect(EXTENSION_KIND_MIN).toBe(16);
    expect(ENVELOPE_HEADER_BYTES).toBe(22);
  });

  it("lays out version, kind, sequence and doc id before the frame", () => {
    const docId = new Uint8Array(16).fill(0xab);
    const bytes = encodeEnvelope({ kind: 3, seq: 0x01020304, docId, frame: new Uint8Array([9, 9]) });
    expect([...bytes.subarray(0, 6)]).toEqual([1, 3, 1, 2, 3, 4]);
    expect(bytes.subarray(6, 22)).toEqual(docId);
    expect([...bytes.subarray(22)]).toEqual([9, 9]);
    expect(decodeEnvelope(bytes)).toEqual({ ok: true, envelope: { kind: 3, seq: 0x01020304, docId, frame: new Uint8Array([9, 9]) } });
  });

  it("refuses a short header and an unknown version", () => {
    expect(decodeEnvelope(new Uint8Array(21))).toEqual({ ok: false, error: "tooShort" });
    const bytes = encodeEnvelope({ kind: 1, seq: 1, docId: new Uint8Array(16), frame: new Uint8Array() });
    bytes[0] = 2;
    expect(decodeEnvelope(bytes)).toEqual({ ok: false, error: "badVersion" });
  });

  it("derives the doc id from SHA-256 of share id, NUL and doc key", async () => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("s1\0main.typ")));
    expect(await deriveDocId("s1", "main.typ")).toEqual(digest.subarray(0, 16));
    expect(await deriveDocId("s1", "index")).not.toEqual(await deriveDocId("s2", "index"));
  });
});
