import { readFrames } from "../../../../src/helper/node/transport/index.js";
import { encodeFrame } from "./frameCodec.js";

async function collect(chunks: Buffer[], maxFrameBytes?: number): Promise<{ frames: string[]; truncated: number[] }> {
  const truncated: number[] = [];
  const frames: string[] = [];
  async function* source() { yield* chunks; }
  for await (const frame of readFrames(source(), { onTruncated: (bytes) => truncated.push(bytes), ...(maxFrameBytes ? { maxFrameBytes } : {}) })) {
    frames.push(frame.toString("utf8"));
  }
  return { frames, truncated };
}

describe("readFrames", () => {
  it("joins a frame split across chunks, even inside the length header", async () => {
    const bytes = encodeFrame({ hello: "world" });
    const { frames } = await collect([bytes.subarray(0, 2), bytes.subarray(2, 7), bytes.subarray(7)]);
    expect(frames).toEqual(['{"hello":"world"}']);
  });

  it("splits several frames delivered in one chunk", async () => {
    const { frames } = await collect([Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }), encodeFrame({ n: 3 })])]);
    expect(frames).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it("reads multi-byte UTF-8 by byte length", async () => {
    const { frames } = await collect([encodeFrame({ t: "é€😀" })]);
    expect(JSON.parse(frames[0]!)).toEqual({ t: "é€😀" });
  });

  it("ends cleanly at EOF and reports bytes of an unfinished frame", async () => {
    const bytes = encodeFrame({ a: 1 });
    const { frames, truncated } = await collect([encodeFrame({ b: 2 }), bytes.subarray(0, bytes.length - 1)]);
    expect(frames).toEqual(['{"b":2}']);
    expect(truncated).toEqual([bytes.length - 1]);
  });

  it("rejects a frame longer than the cap before buffering it", async () => {
    await expect(collect([encodeFrame("x".repeat(200))], 100)).rejects.toThrow(/exceeds/);
  });
});
