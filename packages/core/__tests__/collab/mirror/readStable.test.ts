import { readStable, type MirrorSample } from "../../../src/collab/mirror/index";

const sample = (size: number, mtimeMs: number, ...bytes: number[]): MirrorSample => ({ size, mtimeMs, bytes: Uint8Array.from(bytes) });

/** A sampler that returns the queued samples in order, one per call. */
function sampler(...results: Array<MirrorSample | undefined>) {
  const queue = [...results];
  return jest.fn(async () => queue.shift());
}

async function settled(take: () => Promise<MirrorSample | undefined>, settleMs: number) {
  const pending = readStable(take, settleMs);
  await jest.advanceTimersByTimeAsync(settleMs);
  return pending;
}

describe("readStable", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("takes one sample and no wait when settleMs is undefined", async () => {
    const take = sampler(sample(1, 5, 7));
    expect(await readStable(take)).toEqual({ state: "present", bytes: Uint8Array.from([7]) });
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("reads a missing file as missing with one sample", async () => {
    const take = sampler(undefined);
    expect(await readStable(take)).toEqual({ state: "missing" });
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("waits settleMs before the second sample", async () => {
    const take = sampler(sample(1, 5, 7), sample(1, 5, 7));
    const pending = readStable(take, 100);
    await jest.advanceTimersByTimeAsync(99);
    expect(take).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ state: "present", bytes: Uint8Array.from([7]) });
    expect(take).toHaveBeenCalledTimes(2);
  });

  it("is present when both samples agree", async () => {
    expect(await settled(sampler(sample(2, 5, 1, 2), sample(2, 5, 1, 2)), 50)).toEqual({ state: "present", bytes: Uint8Array.from([1, 2]) });
  });

  it.each([
    ["size", sample(3, 5, 1, 2, 3)],
    ["mtime", sample(2, 6, 1, 2)],
    ["bytes", sample(2, 5, 1, 9)],
  ] as Array<[string, MirrorSample]>)("is changing when the %s differs", async (_name, second) => {
    expect(await settled(sampler(sample(2, 5, 1, 2), second), 50)).toEqual({ state: "changing" });
  });

  it("is changing when the file vanishes between samples", async () => {
    expect(await settled(sampler(sample(2, 5, 1, 2), undefined), 50)).toEqual({ state: "changing" });
  });

  it("is changing when the file appears between samples", async () => {
    expect(await settled(sampler(undefined, sample(2, 5, 1, 2)), 50)).toEqual({ state: "changing" });
  });

  it("is missing when the file is missing in both samples", async () => {
    expect(await settled(sampler(undefined, undefined), 50)).toEqual({ state: "missing" });
  });
});
