/** Verifies the helper's connection: the loopback WebSocket server (origin check, token handshake, single authenticated socket, binary-only frames, 16 MiB cap) and the stdio frame reader and writer. */
import { RawWebSocketClient } from "../../support/rawWebSocketClient";
import { fakeLogger, type RecordingLogger } from "../../support/fakeLogger";
import type { ILogger } from "../../../src/ports/index.js";
import { decodeConnectionMessage, encodeConnectionMessage } from "../../../src/helper/helperPaths";
import { createFrameWriter, MAX_OUTGOING_FRAME_BYTES, readFrames, startHelperServer } from "../../../src/helper/node/helperConnection";
import { PROTOCOL_VERSION } from "../../../src/helper/index";
import { decodeFrames, encodeFrame } from "./helperConnectionHarness";

const ORIGIN = "chrome-extension://abcdefghijklmnop";
const TOKEN = "t0ken";
const auth = (token = TOKEN) => encodeConnectionMessage({ v: PROTOCOL_VERSION, id: "1", type: "auth", token });

type Handle = (envelope: Record<string, unknown>, payload: Uint8Array, send: (envelope: Record<string, unknown>, payload?: Uint8Array) => void) => void | Promise<void>;
let logger: RecordingLogger;
let received: Array<{ envelope: Record<string, unknown>; payload: Uint8Array }>;
let server: Awaited<ReturnType<typeof startHelperServer>>;

async function start(options: { callerOrigin?: string; handle?: Handle; authTimeoutMs?: number } = {}) {
  server = await startHelperServer({
    token: TOKEN, origin: ORIGIN, callerOrigin: options.callerOrigin, logger, ...(options.authTimeoutMs !== undefined && { authTimeoutMs: options.authTimeoutMs }),
    handle: options.handle ?? ((envelope, payload) => { received.push({ envelope, payload }); }),
  });
}
const logged = (pattern: RegExp) => logger.logs.some((entry) => pattern.test(entry.message));

describe("startHelperServer", () => {
  beforeEach(() => { logger = fakeLogger(); received = []; });
  afterEach(async () => { await server?.close(); });

  it("listens on an OS-picked loopback port", async () => {
    await start();
    expect(server.port).toBeGreaterThan(0);
    const { status, client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    expect(status).toBe(101);
    client.destroy();
  });

  it("answers a correct auth with authed, then hands decoded messages to handle", async () => {
    await start();
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    client.sendBinary(auth());
    expect(decodeConnectionMessage(await client.nextMessage()).envelope).toMatchObject({ v: PROTOCOL_VERSION, id: "1", type: "authed" });
    client.sendBinary(encodeConnectionMessage({ v: PROTOCOL_VERSION, id: "2", type: "save", projectId: "p", path: "a.tex" }, new Uint8Array([5, 6])));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toHaveLength(1);
    expect(received[0]!.envelope).toMatchObject({ id: "2", type: "save" });
    expect(Array.from(received[0]!.payload)).toEqual([5, 6]);
    client.destroy();
  });

  it("lets handle reply on the socket with a payload", async () => {
    await start({ handle: (envelope, _payload, send) => send({ v: PROTOCOL_VERSION, id: envelope.id, type: "pages" }, new Uint8Array([7])) });
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    client.sendBinary(auth());
    await client.nextMessage();
    client.sendBinary(encodeConnectionMessage({ v: PROTOCOL_VERSION, id: "3", type: "compile" }));
    const reply = decodeConnectionMessage(await client.nextMessage());
    expect(reply.envelope).toMatchObject({ id: "3", type: "pages" });
    expect(Array.from(reply.payload)).toEqual([7]);
    client.destroy();
  });

  it("refuses the upgrade when Origin differs from the hello origin, and logs why", async () => {
    await start();
    const { status } = await RawWebSocketClient.connect(server.port, "chrome-extension://zzzzzzzzzzzzzzzz");
    expect(status).not.toBe(101);
    expect(logged(/origin/i)).toBe(true);
  });

  it("refuses the upgrade without an Origin header", async () => {
    await start();
    const { status } = await RawWebSocketClient.connect(server.port, undefined);
    expect(status).not.toBe(101);
    expect(logged(/origin/i)).toBe(true);
  });

  it("refuses an origin that is not an extension origin even when it matches hello", async () => {
    server = await startHelperServer({ token: TOKEN, origin: "https://evil.example", logger, handle: () => undefined });
    const { status } = await RawWebSocketClient.connect(server.port, "https://evil.example");
    expect(status).not.toBe(101);
    expect(logged(/origin/i)).toBe(true);
  });

  it("refuses an origin that differs from the caller origin Chrome passed", async () => {
    await start({ callerOrigin: "chrome-extension://bbbbbbbbbbbbbbbb" });
    const { status } = await RawWebSocketClient.connect(server.port, ORIGIN);
    expect(status).not.toBe(101);
    expect(logged(/origin/i)).toBe(true);
  });

  it("refuses an upgrade that asks for a subprotocol", async () => {
    await start();
    const { status } = await RawWebSocketClient.connect(server.port, ORIGIN, ["Sec-WebSocket-Protocol: chat"]);
    expect(status).not.toBe(101);
    expect(logged(/protocol|extension/i)).toBe(true);
  });

  it("ignores a requested extension: the upgrade succeeds, names no extension, and an RSV1 frame closes the socket", async () => {
    await start();
    const { status, client, headers } = await RawWebSocketClient.connect(server.port, ORIGIN, ["Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits"]);
    expect(status).toBe(101);
    expect(headers.toLowerCase()).not.toContain("sec-websocket-extensions");
    client.sendBinary(auth());
    await client.nextMessage();
    client.sendBinary(new Uint8Array([1, 2, 3]), 0x40);
    await client.closed;
    expect(logged(/rsv|extension/i)).toBe(true);
    expect(received).toHaveLength(0);
  });

  it("closes the socket when the first frame carries the wrong token", async () => {
    await start();
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    client.sendBinary(auth("wrong"));
    await client.closed;
    expect(logged(/token|auth/i)).toBe(true);
    expect(received).toHaveLength(0);
  });

  it("closes the socket when the first frame is not auth", async () => {
    await start();
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    client.sendBinary(encodeConnectionMessage({ v: PROTOCOL_VERSION, id: "1", type: "save", projectId: "p", path: "a.tex" }));
    await client.closed;
    expect(logged(/auth/i)).toBe(true);
    expect(received).toHaveLength(0);
  });

  it("refuses a second socket that authenticates while the first is live", async () => {
    await start();
    const first = (await RawWebSocketClient.connect(server.port, ORIGIN)).client;
    first.sendBinary(auth());
    await first.nextMessage();
    const second = (await RawWebSocketClient.connect(server.port, ORIGIN)).client;
    second.sendBinary(auth());
    await second.closed;
    expect(logged(/second|already/i)).toBe(true);
    first.sendBinary(encodeConnectionMessage({ v: PROTOCOL_VERSION, id: "9", type: "save", projectId: "p", path: "a.tex" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toHaveLength(1);
    first.destroy();
  });

  it("closes the socket when the first frame is an auth without a token", async () => {
    await start();
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    client.sendBinary(encodeConnectionMessage({ v: PROTOCOL_VERSION, id: "1", type: "auth" }));
    await client.closed;
    expect(logged(/not a valid auth/i)).toBe(true);
  });

  it("refuses a later auth with the same token once the authenticated socket has closed", async () => {
    await start();
    const first = (await RawWebSocketClient.connect(server.port, ORIGIN)).client;
    first.sendBinary(auth());
    await first.nextMessage();
    first.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = (await RawWebSocketClient.connect(server.port, ORIGIN)).client;
    second.sendBinary(auth());
    await second.closed;
    expect(logged(/spent/i)).toBe(true);
  });

  it("closes a socket that has not authenticated within the auth timeout, and logs it", async () => {
    await start({ authTimeoutMs: 50 });
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    await client.closed;
    expect(logged(/no auth within 50 ms/)).toBe(true);
  });

  it("keeps an authenticated socket open past the auth timeout", async () => {
    await start({ authTimeoutMs: 100 });
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    client.sendBinary(auth());
    await client.nextMessage();
    await new Promise((resolve) => setTimeout(resolve, 250));
    client.sendBinary(encodeConnectionMessage({ v: PROTOCOL_VERSION, id: "2", type: "save", projectId: "p", path: "a.tex" }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toHaveLength(1);
    client.destroy();
  });

  it("closes the socket on a text frame, even after auth", async () => {
    await start();
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    client.sendBinary(auth());
    await client.nextMessage();
    client.sendText("{}");
    await client.closed;
    expect(logged(/text/i)).toBe(true);
  });

  it("closes the socket on a frame over 16 MiB", async () => {
    await start();
    const { client } = await RawWebSocketClient.connect(server.port, ORIGIN);
    client.sendBinary(auth());
    await client.nextMessage();
    client.sendBinary(new Uint8Array(16 * 1024 * 1024 + 1));
    await client.closed;
    expect(logged(/16 MiB|too large|size|limit/i)).toBe(true);
  });

  it("stops accepting connections after close", async () => {
    await start();
    const { port } = server;
    await server.close();
    await expect(RawWebSocketClient.connect(port, ORIGIN)).rejects.toBeDefined();
  });
});

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

function setup() {
  const written: Buffer[] = [];
  const logs: string[] = [];
  const writerLogger = { log: async (_l: string, _m: string, message: string) => { logs.push(message); }, error: async () => undefined } as unknown as ILogger;
  const send = createFrameWriter({ write: (chunk: Buffer) => written.push(chunk) }, writerLogger);
  return { send, logs, output: () => decodeFrames(Buffer.concat(written)) };
}

describe("createFrameWriter", () => {
  it("writes a length-prefixed JSON frame", () => {
    const { send, output } = setup();
    send({ v: PROTOCOL_VERSION, id: "1", type: "session", port: 4242, token: "t" });
    expect(output()).toEqual([{ v: PROTOCOL_VERSION, id: "1", type: "session", port: 4242, token: "t" }]);
  });

  it("refuses a frame over 1 MB, logs it and answers a limit error with the same id", () => {
    const { send, logs, output } = setup();
    send({ v: PROTOCOL_VERSION, id: "9", type: "error", code: "io", message: "A".repeat(MAX_OUTGOING_FRAME_BYTES) });
    const frames = output() as Array<{ type: string; id: string; code: string }>;
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: "error", id: "9", code: "limit" });
    expect(logs.join("\n")).toMatch(/refus/i);
  });
});
