import { PassThrough } from "node:stream";

import type { HelperLogger } from "../../../../../src/writing/helper/node/log/index.js";
import { answerHello, createDispatcher, runHelperLoop, type HelloAnswer } from "../../../../../src/writing/helper/node/dispatch/index.js";
import type { HelperSocket } from "../../../../../src/writing/helper/node/socket/index.js";
import { createFrameWriter } from "../../../../../src/writing/helper/node/stdio/index.js";
import { decodeFrames, encodeFrame } from "../stdio/frameCodec.js";
import { PROTOCOL_VERSION } from "../../../../../src/writing/helper/index.js";

const logger = { log: async () => undefined, error: async () => undefined, redact: () => undefined } as unknown as HelperLogger;
const hello = (id: string, origin = "chrome-extension://abcdefghijklmnop") => encodeFrame({ v: PROTOCOL_VERSION, id, type: "hello", extensionVersion: "0.2.0", origin });

async function run(inputChunks: Buffer[], onVersionRejected?: () => void): Promise<Array<Record<string, unknown>>> {
  const input = new PassThrough();
  const written: Buffer[] = [];
  const send = createFrameWriter({ write: (chunk: Buffer) => written.push(chunk) }, logger);
  const sockets: HelperSocket[] = [];
  const dispatcher = createDispatcher({}, logger);
  const answer: HelloAnswer = async (message, reply) => {
    const socket = await answerHello(message, reply, {
      helperVersion: "0.1.0", host: "vscode", texStatus: async () => ({ source: "none", complete: false }), logger, handle: dispatcher.handle,
    });
    if (socket) { sockets.push(socket); }
    return socket !== undefined;
  };
  const done = runHelperLoop(input, answer, send, logger, onVersionRejected);
  for (const chunk of inputChunks) { input.write(chunk); }
  input.end();
  await done;
  await Promise.all(sockets.map((socket) => socket.close()));
  return decodeFrames(Buffer.concat(written)) as Array<Record<string, unknown>>;
}

describe("runHelperLoop", () => {
  it("answers hello with ready, then session with the socket's port and token", async () => {
    const frames = await run([hello("1")]);
    expect(frames[0]).toEqual({ v: PROTOCOL_VERSION, id: "1", type: "ready", protocol: PROTOCOL_VERSION, helperVersion: "0.1.0", host: "vscode", tex: { source: "none", complete: false } });
    expect(frames[1]).toMatchObject({ v: PROTOCOL_VERSION, id: "1", type: "session" });
    expect(typeof frames[1]!.port).toBe("number");
    expect(frames[1]!.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("refuses an origin that is not an extension page", async () => {
    const frames = await run([hello("1", "https://example.com")]);
    expect(frames).toMatchObject([{ id: "1", type: "error", code: "invalid-field" }]);
  });

  it("refuses a second hello and any other native message with unknown-type", async () => {
    const other = encodeFrame({ v: PROTOCOL_VERSION, id: "3", type: "cancel", projectId: "p" });
    const frames = await run([Buffer.concat([hello("1"), hello("2"), other])]);
    expect(frames.map((f) => f.type)).toEqual(["ready", "session", "error", "error"]);
    expect(frames.slice(2)).toMatchObject([{ id: "2", code: "unknown-type" }, { id: "3", code: "unknown-type" }]);
  });

  it("survives bad JSON before the hello", async () => {
    const frames = await run([Buffer.concat([encodeFrame("{bad"), hello("2")])]);
    expect(frames.map((f) => f.type)).toEqual(["error", "ready", "session"]);
  });

  it("answers a hello of another protocol version with a version error and reports it once", async () => {
    const onVersionRejected = jest.fn();
    const stale = encodeFrame({ v: PROTOCOL_VERSION - 1, id: "1", type: "hello", extensionVersion: "0.2.0", origin: "chrome-extension://abcdefghijklmnop" });
    const frames = await run([stale, hello("2")], onVersionRejected);
    expect(frames.map((f) => f.type)).toEqual(["error", "ready", "session"]);
    expect(frames[0]).toMatchObject({ id: "1", code: "version" });
    expect(onVersionRejected).toHaveBeenCalledTimes(1);
  });
});
