/**
 * Pins the clear envelope header and the opaque doc id every share message travels under.
 * Pins that ordered link epochs keep a reopened link apart from the one it replaced, for frames and for acks.
 */
import {
  decodeEnvelope,
  encodeEnvelope,
  ENVELOPE_HEADER_BYTES,
  EXTENSION_KIND_MIN,
  MESSAGE_KIND,
  ENVELOPE_VERSION,
  deriveDocId,
} from "../../src/collab/index";
import {
  ACK_DELAY_MS,
  createEpochSource,
  decodeAck,
  encodeAck,
  RESEND_AFTER_MS,
  ReliableConnection,
  type ConnectionIo,
} from "../../src/collab/channel";
import { FakeClock } from "./fakeNetwork";

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

function recordingIo() {
  const sent: Uint8Array[] = [];
  const acks: { epoch: bigint; seqs: number[] }[] = [];
  const io: ConnectionIo = { transmit: (bytes) => sent.push(bytes), sendAck: (epoch, seqs) => acks.push({ epoch, seqs }), onGiveUp: () => {} };
  return { io, sent, acks };
}

describe("reliable link epochs", () => {
  let clock: FakeClock;
  beforeEach(() => { clock = new FakeClock(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it("keeps a pending frame when an ack of the old link's epoch arrives", () => {
    const { io, sent } = recordingIo();
    const link = new ReliableConnection(io, clock, 2n);
    link.send((seq) => new Uint8Array([seq]));
    link.acknowledge(1n, [1]);
    clock.advance(RESEND_AFTER_MS);
    expect(sent).toHaveLength(2);
    link.acknowledge(2n, [1]);
    clock.advance(RESEND_AFTER_MS * 2);
    expect(sent).toHaveLength(2);
    link.close();
  });

  it("restarts the sequence on a higher epoch and drops a frame of a lower epoch without acking it", () => {
    const { io, acks } = recordingIo();
    const link = new ReliableConnection(io, clock, 9n);
    expect(link.accept(10n, 1)).toBe(true);
    expect(link.accept(10n, 2)).toBe(true);
    expect(link.accept(20n, 1)).toBe(true);
    expect(link.accept(10n, 3)).toBe(false);
    expect(link.accept(20n, 1)).toBe(false);
    clock.advance(ACK_DELAY_MS);
    expect(acks).toEqual([{ epoch: 20n, seqs: [1, 1] }]);
    link.close();
  });

  it("drops a late frame of an earlier epoch that arrives first, and keeps the later epoch", () => {
    const { io, acks } = recordingIo();
    const link = new ReliableConnection(io, clock, 9n);
    expect(link.accept(20n, 1)).toBe(true);
    expect(link.accept(10n, 7)).toBe(false);
    expect(link.accept(20n, 2)).toBe(true);
    clock.advance(ACK_DELAY_MS);
    expect(acks).toEqual([{ epoch: 20n, seqs: [1, 2] }]);
    link.close();
  });

  it("drops a reliable frame of epoch 0 without acking it", () => {
    const { io, acks } = recordingIo();
    const link = new ReliableConnection(io, clock, 9n);
    expect(link.accept(0n, 1)).toBe(false);
    clock.advance(ACK_DELAY_MS);
    expect(acks).toEqual([]);
    link.close();
  });

  it("treats a gap older than the out-of-order window as delivered after a mid-sequence adoption", () => {
    const { io } = recordingIo();
    const link = new ReliableConnection(io, clock, 9n);
    expect(link.accept(5n, 5000)).toBe(true);
    for (let seq = 5001; seq < 6000; seq += 1) { link.accept(5n, seq); }
    expect(link.accept(5n, 2)).toBe(true);
    for (let seq = 6000; seq < 6100; seq += 1) { link.accept(5n, seq); }
    expect(link.accept(5n, 3)).toBe(false);
    expect(link.accept(5n, 6050)).toBe(false);
    expect(link.accept(5n, 6100)).toBe(true);
    link.close();
  });

  it("round-trips an ack payload with its 8-byte epoch", () => {
    const epoch = 0xfedcba9876543210n;
    const bytes = encodeAck(epoch, [1, 0x01020304]);
    expect([...bytes.subarray(0, 8)]).toEqual([0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10]);
    expect(decodeAck(bytes)).toEqual({ epoch, seqs: [1, 0x01020304] });
    expect(decodeAck(new Uint8Array(7))).toEqual({ epoch: 0n, seqs: [] });
  });
});

describe("link epoch source", () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it("puts the open time in the high 48 bits", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    expect(createEpochSource()() >> 16n).toBe(1_700_000_000_000n);
  });

  it("keeps a sender's epochs increasing when the clock goes backwards or stands still", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const next = createEpochSource();
    const first = next();
    const second = next();
    now.mockReturnValue(1_600_000_000_000);
    const third = next();
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });
});
