/** Pins that ordered link epochs keep a reopened link apart from the one it replaced, for frames and for acks. */
import {
  ACK_DELAY_MS, createEpochSource, decodeAck, encodeAck, RESEND_AFTER_MS, ReliableLink, type LinkIo,
} from "../../../src/collab/peer/reliableChannel";
import { FakeClock } from "./fakeNetwork";

function recordingIo() {
  const sent: Uint8Array[] = [];
  const acks: { epoch: bigint; seqs: number[] }[] = [];
  const io: LinkIo = { transmit: (bytes) => sent.push(bytes), sendAck: (epoch, seqs) => acks.push({ epoch, seqs }), onGiveUp: () => {} };
  return { io, sent, acks };
}

describe("reliable link epochs", () => {
  let clock: FakeClock;
  beforeEach(() => { clock = new FakeClock(); });
  afterEach(() => { jest.restoreAllMocks(); });

  it("keeps a pending frame when an ack of the old link's epoch arrives", () => {
    const { io, sent } = recordingIo();
    const link = new ReliableLink(io, clock, 2n);
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
    const link = new ReliableLink(io, clock, 9n);
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
    const link = new ReliableLink(io, clock, 9n);
    expect(link.accept(20n, 1)).toBe(true);
    expect(link.accept(10n, 7)).toBe(false);
    expect(link.accept(20n, 2)).toBe(true);
    clock.advance(ACK_DELAY_MS);
    expect(acks).toEqual([{ epoch: 20n, seqs: [1, 2] }]);
    link.close();
  });

  it("drops a reliable frame of epoch 0 without acking it", () => {
    const { io, acks } = recordingIo();
    const link = new ReliableLink(io, clock, 9n);
    expect(link.accept(0n, 1)).toBe(false);
    clock.advance(ACK_DELAY_MS);
    expect(acks).toEqual([]);
    link.close();
  });

  it("treats a gap older than the out-of-order window as delivered after a mid-sequence adoption", () => {
    const { io } = recordingIo();
    const link = new ReliableLink(io, clock, 9n);
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
