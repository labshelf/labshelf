/** Pins the clear envelope header and the opaque doc id every share message travels under. */
import { decodeEnvelope, encodeEnvelope, ENVELOPE_HEADER_BYTES, EXTENSION_KIND_MIN, MESSAGE_KIND, ENVELOPE_VERSION } from "../../../src/collab/peer/envelope";
import { deriveDocId } from "../../../src/collab/peer/docId";

describe("envelope", () => {
  it("pins the protocol version and message kinds", () => {
    expect(ENVELOPE_VERSION).toBe(3);
    expect(MESSAGE_KIND).toEqual({ syncStep1: 1, syncStep2: 2, update: 3, ack: 4 });
    expect(EXTENSION_KIND_MIN).toBe(16);
    expect(ENVELOPE_HEADER_BYTES).toBe(30);
  });

  it("lays out version, kind, epoch, sequence and doc id before the frame", () => {
    const docId = new Uint8Array(16).fill(0xab);
    const envelope = { kind: 3, epoch: 0xa1b2c3d4e5f60718n, seq: 0x01020304, docId, frame: new Uint8Array([9, 9]) };
    const bytes = encodeEnvelope(envelope);
    expect([...bytes.subarray(0, 14)]).toEqual([3, 3, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18, 1, 2, 3, 4]);
    expect(bytes.subarray(14, 30)).toEqual(docId);
    expect([...bytes.subarray(30)]).toEqual([9, 9]);
    expect(decodeEnvelope(bytes)).toEqual({ ok: true, envelope });
  });

  it("refuses a short header and an unknown version", () => {
    expect(decodeEnvelope(new Uint8Array(29))).toEqual({ ok: false, error: "tooShort" });
    const bytes = encodeEnvelope({ kind: 1, epoch: 7n, seq: 1, docId: new Uint8Array(16), frame: new Uint8Array() });
    bytes[0] = 1;
    expect(decodeEnvelope(bytes)).toEqual({ ok: false, error: "badVersion" });
  });

  it("derives the doc id from SHA-256 of share id, NUL and doc key", async () => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("s1\0main.typ")));
    expect(await deriveDocId("s1", "main.typ")).toEqual(digest.subarray(0, 16));
    expect(await deriveDocId("s1", "index")).not.toEqual(await deriveDocId("s2", "index"));
  });
});
