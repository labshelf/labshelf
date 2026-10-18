import type { ILogger } from "@labshelf/core";

import { createFrameWriter, MAX_OUTGOING_FRAME_BYTES } from "../../../src/helper/stdio/index.js";
import { decodeFrames } from "./frameCodec.js";

function setup() {
  const written: Buffer[] = [];
  const logs: string[] = [];
  const logger = { log: async (_l: string, _m: string, message: string) => { logs.push(message); }, error: async () => undefined } as unknown as ILogger;
  const send = createFrameWriter({ write: (chunk: Buffer) => written.push(chunk) }, logger);
  return { send, logs, output: () => decodeFrames(Buffer.concat(written)) };
}

describe("createFrameWriter", () => {
  it("writes a length-prefixed JSON frame", () => {
    const { send, output } = setup();
    send({ v: 1, id: "1", type: "need", paths: ["a.tex"] });
    expect(output()).toEqual([{ v: 1, id: "1", type: "need", paths: ["a.tex"] }]);
  });

  it("refuses a frame over 1 MB, logs it and answers a limit error with the same id", () => {
    const { send, logs, output } = setup();
    send({ v: 1, id: "9", type: "pdf", chunk: { index: 0, count: 1, data: "A".repeat(MAX_OUTGOING_FRAME_BYTES) } });
    const frames = output() as Array<{ type: string; id: string; code: string }>;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: "error", id: "9", code: "limit" });
    expect(logs.join("\n")).toMatch(/refus/i);
  });
});
