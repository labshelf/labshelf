import { PassThrough } from "node:stream";

import type { ILogger } from "@labshelf/core";

import { createDispatcher, createHelloHandler, runHelperLoop } from "../../../src/helper/dispatch/index.js";
import { createFrameWriter } from "../../../src/helper/stdio/index.js";
import { decodeFrames, encodeFrame } from "../stdio/frameCodec.js";

const logger = { log: async () => undefined, error: async () => undefined } as unknown as ILogger;

async function run(inputChunks: Buffer[]): Promise<unknown[]> {
  const input = new PassThrough();
  const written: Buffer[] = [];
  const send = createFrameWriter({ write: (chunk: Buffer) => written.push(chunk) }, logger);
  const dispatcher = createDispatcher({ hello: createHelloHandler({ helperVersion: "0.1.0", tex: { source: "none", complete: false } }) }, send, logger);
  const done = runHelperLoop(input, dispatcher, logger);
  for (const chunk of inputChunks) { input.write(chunk); }
  input.end();
  await done;
  return decodeFrames(Buffer.concat(written));
}

describe("runHelperLoop", () => {
  it("answers hello with ready and exits at EOF", async () => {
    const frames = await run([encodeFrame({ v: 1, id: "1", type: "hello", extensionVersion: "0.2.0" })]);
    expect(frames).toEqual([{ v: 1, id: "1", type: "ready", protocol: 1, helperVersion: "0.1.0", tex: { source: "none", complete: false } }]);
  });

  it("survives bad JSON between good frames", async () => {
    const hello = (id: string) => encodeFrame({ v: 1, id, type: "hello", extensionVersion: "0.2.0" });
    const frames = await run([Buffer.concat([hello("1"), encodeFrame("{bad"), hello("2")])]) as Array<{ type: string; id: string }>;
    expect(frames.map((f) => f.type)).toEqual(["ready", "error", "ready"]);
    expect(frames[2]!.id).toBe("2");
  });
});
