/** Pins the binary socket messages between a client and the relay: layout, round trips, hostile input and minor evolution. */
import {
  decodeClientMessage, decodeServerMessage, encodeRelayMessage, MAX_RELAY_MESSAGE_BYTES,
  type RelayClientMessage, type RelayServerMessage,
} from "../../../src/relay/index";

const doc = "00112233445566778899aabbccddeeff";
const frame = new Uint8Array([7, 8, 9]);

const clientMessages: RelayClientMessage[] = [
  { type: "put", doc, frame },
  { type: "since", doc, cursor: 0 },
  { type: "since", doc, cursor: 0xffffffff },
  { type: "snapshot", doc, covers: 42, frame },
  { type: "forward", to: 0, frame },
  { type: "forward", to: 7, frame },
];

const serverMessages: RelayServerMessage[] = [
  { type: "accepted", doc, cursor: 5 },
  { type: "stored", from: 3, doc, cursor: 6, frame },
  { type: "rows", doc, more: false, items: [] },
  { type: "rows", doc, more: true, items: [{ cursor: 1, frame }, { cursor: 2, frame: new Uint8Array([1]) }] },
  { type: "rows", doc, more: false, snapshot: { covers: 9, frame }, items: [{ cursor: 10, frame }] },
  { type: "forwarded", from: 2, frame },
  { type: "peers", ids: [] },
  { type: "peers", ids: [1, 2, 3] },
  { type: "joined", id: 4 },
  { type: "left", id: 4 },
  { type: "error", code: 4, doc },
  { type: "error", code: 1 },
];

describe("relay socket messages", () => {
  it.each(clientMessages)("round-trips client message %#", (message) => {
    expect(decodeClientMessage(encodeRelayMessage(message))).toEqual({ ok: true, minor: 1, message });
  });

  it.each(serverMessages)("round-trips server message %#", (message) => {
    expect(decodeServerMessage(encodeRelayMessage(message))).toEqual({ ok: true, minor: 1, message });
  });

  it("lays out version, type, doc and a length-prefixed frame", () => {
    const bytes = encodeRelayMessage({ type: "put", doc, frame });
    expect([...bytes.subarray(0, 3)]).toEqual([1, 1, 1]);
    expect([...bytes.subarray(3, 19)]).toEqual([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
    expect([...bytes.subarray(19)]).toEqual([0, 0, 0, 3, 7, 8, 9]);
    expect([...encodeRelayMessage({ type: "joined", id: 0x01020304 })]).toEqual([1, 1, 21, 1, 2, 3, 4]);
  });

  it("refuses to encode a bad doc id, an out-of-range integer or an empty frame", () => {
    expect(() => encodeRelayMessage({ type: "put", doc: "ABC", frame })).toThrow(RangeError);
    expect(() => encodeRelayMessage({ type: "since", doc, cursor: -1 })).toThrow(RangeError);
    expect(() => encodeRelayMessage({ type: "since", doc, cursor: 2 ** 32 })).toThrow(RangeError);
    expect(() => encodeRelayMessage({ type: "put", doc, frame: new Uint8Array() })).toThrow(RangeError);
  });

  it("keeps each direction to its own types", () => {
    expect(decodeServerMessage(encodeRelayMessage({ type: "put", doc, frame }))).toEqual({ ok: false, error: "unknownType", type: 1 });
    expect(decodeClientMessage(encodeRelayMessage({ type: "joined", id: 1 }))).toEqual({ ok: false, error: "unknownType", type: 21 });
  });

  describe("hostile input", () => {
    const put = encodeRelayMessage({ type: "put", doc, frame });

    it("returns typed errors and never throws", () => {
      expect(decodeClientMessage(new Uint8Array())).toEqual({ ok: false, error: "tooShort" });
      expect(decodeClientMessage(new Uint8Array([1, 0]))).toEqual({ ok: false, error: "tooShort" });
      expect(decodeClientMessage(new Uint8Array([2, 0, 1]))).toEqual({ ok: false, error: "incompatibleVersion", major: 2 });
      expect(decodeClientMessage(new Uint8Array([0, 0, 1]))).toEqual({ ok: false, error: "incompatibleVersion", major: 0 });
      expect(decodeClientMessage(put.subarray(0, 10))).toEqual({ ok: false, error: "malformed" });
      expect(decodeClientMessage(put.subarray(0, put.length - 1))).toEqual({ ok: false, error: "malformed" });
      expect(decodeClientMessage(new Uint8Array(MAX_RELAY_MESSAGE_BYTES + 1).fill(1))).toEqual({ ok: false, error: "tooLarge" });
    });

    it("refuses a frame length beyond the message and an empty frame", () => {
      const huge = put.slice();
      new DataView(huge.buffer).setUint32(19, 0xffffffff);
      expect(decodeClientMessage(huge)).toEqual({ ok: false, error: "malformed" });
      const empty = new Uint8Array([1, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(decodeClientMessage(empty)).toEqual({ ok: false, error: "malformed" });
    });

    it("refuses a count that the message cannot hold", () => {
      expect(decodeServerMessage(new Uint8Array([1, 0, 20, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 1]))).toEqual({ ok: false, error: "malformed" });
      const rows = encodeRelayMessage({ type: "rows", doc, more: false, items: [{ cursor: 1, frame }] });
      new DataView(rows.buffer).setUint32(20, 1000);
      expect(decodeServerMessage(rows)).toEqual({ ok: false, error: "malformed" });
    });

    it("survives random bytes", () => {
      let seed = 1;
      const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % 256;
      for (let run = 0; run < 2000; run += 1) {
        const bytes = Uint8Array.from({ length: random() % 64 }, random);
        if (bytes.length > 0) { bytes[0] = 1; }
        expect(() => { decodeClientMessage(bytes); decodeServerMessage(bytes); }).not.toThrow();
      }
    });
  });

  describe("a newer minor talking to this version", () => {
    it("reads the fields it knows and ignores fields a newer minor appends", () => {
      const put = encodeRelayMessage({ type: "put", doc, frame });
      const newer = new Uint8Array([...put, 0xde, 0xad]);
      newer[1] = 3;
      expect(decodeClientMessage(newer)).toEqual({ ok: true, minor: 3, message: { type: "put", doc, frame } });
    });

    it("reports a type it does not know so the receiver can ignore it", () => {
      expect(decodeClientMessage(new Uint8Array([1, 1, 5, 9, 9]))).toEqual({ ok: false, error: "unknownType", type: 5 });
      expect(decodeServerMessage(new Uint8Array([1, 1, 30]))).toEqual({ ok: false, error: "unknownType", type: 30 });
    });

    it("keeps an error code it does not know", () => {
      const bytes = encodeRelayMessage({ type: "error", code: 1 });
      bytes[3] = 200;
      expect(decodeServerMessage(bytes)).toEqual({ ok: true, minor: 1, message: { type: "error", code: 200 } });
    });
  });
});
