/** Pins the bridge protocol: request validation, version checks, file chunking, Native Messaging framing and changed-event batching. */
import {
  assertSameProtocol, BRIDGE_CHUNK_BYTES, BRIDGE_PROTOCOL, createChangedEvents, encodeFrame, FrameDecoder,
  HOST_MESSAGE_LIMIT, parseBridgeRequest, splitFileChunks,
} from "../../src/bridge/protocol";
import { BridgeError } from "../../src/bridge/bridgeError";

describe("parseBridgeRequest", () => {
  it("accepts every op with its fields", () => {
    expect(parseBridgeRequest({ id: 1, op: "hello", protocol: 1 })).toEqual({ id: 1, op: "hello", protocol: 1 });
    expect(parseBridgeRequest({ id: 2, op: "rename", from: "a", to: "b" })).toEqual({ id: 2, op: "rename", from: "a", to: "b" });
    expect(parseBridgeRequest({ id: 3, op: "chunk", data: "AA==" })).toEqual({ id: 3, op: "chunk", data: "AA==" });
    expect(parseBridgeRequest({ id: 4, op: "commit", size: 0 })).toEqual({ id: 4, op: "commit", size: 0 });
    expect(parseBridgeRequest({ id: 5, op: "listDir", path: "" })).toEqual({ id: 5, op: "listDir", path: "" });
    expect(parseBridgeRequest({ id: 7, op: "setLibrary", root: "/Users/you/LabShelf" })).toEqual({ id: 7, op: "setLibrary", root: "/Users/you/LabShelf" });
    expect(parseBridgeRequest({ id: 8, op: "setLibrary", root: "C:\\Users\\you\\LabShelf" })).toMatchObject({ op: "setLibrary" });
    expect(parseBridgeRequest({ id: 6, op: "deleteDir", path: "papers/a" })).toEqual({ id: 6, op: "deleteDir", path: "papers/a" });
  });

  it.each([
    ["no id", { op: "stat", path: "a" }],
    ["unknown op", { id: 1, op: "format" }],
    ["missing path", { id: 1, op: "stat" }],
    ["deleteDir without a path", { id: 1, op: "deleteDir" }],
    ["non-string path", { id: 1, op: "readFile", path: 3 }],
    ["missing rename target", { id: 1, op: "rename", from: "a" }],
    ["not an object", "hello"],
    ["setLibrary without a root", { id: 1, op: "setLibrary" }],
    ["setLibrary with a non-string root", { id: 1, op: "setLibrary", root: 3 }],
    ["setLibrary with an empty root", { id: 1, op: "setLibrary", root: "" }],
    ["setLibrary with a relative root", { id: 1, op: "setLibrary", root: "LabShelf" }],
    ["commit without size", { id: 1, op: "commit" }],
    ["commit with a negative size", { id: 1, op: "commit", size: -1 }],
    ["commit with a fractional size", { id: 1, op: "commit", size: 1.5 }],
  ])("refuses %s with a protocol error", (_name, value) => {
    expect(() => parseBridgeRequest(value)).toThrow(expect.objectContaining({ code: "protocol" }));
  });
});

describe("assertSameProtocol", () => {
  it("accepts the same version and refuses another one with both versions in the message", () => {
    expect(() => assertSameProtocol(BRIDGE_PROTOCOL)).not.toThrow();
    expect(() => assertSameProtocol(BRIDGE_PROTOCOL + 1)).toThrow(
      expect.objectContaining({ code: "protocol", message: expect.stringContaining(String(BRIDGE_PROTOCOL + 1)) }),
    );
    expect(() => assertSameProtocol("1")).toThrow(expect.objectContaining({ code: "protocol" }));
  });
});

describe("file chunks", () => {
  it("splits bytes into base64 chunks of at most the chunk size", () => {
    const bytes = new Uint8Array(BRIDGE_CHUNK_BYTES * 2 + 7).map((_, i) => (i * 31) % 256);
    const chunks = splitFileChunks(bytes);
    expect(chunks).toHaveLength(3);
    expect(Buffer.from(chunks[0] ?? "", "base64").length).toBe(BRIDGE_CHUNK_BYTES);
    expect(new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c, "base64"))))).toEqual(bytes);
  });

  it("yields no chunk for an empty file", () => {
    expect(splitFileChunks(new Uint8Array())).toEqual([]);
  });
});

describe("encodeFrame", () => {
  it("prefixes the UTF-8 JSON with its byte length, little-endian", () => {
    const frame = encodeFrame({ text: "é" });
    const json = new TextEncoder().encode(JSON.stringify({ text: "é" }));
    expect(new DataView(frame.buffer, frame.byteOffset).getUint32(0, true)).toBe(json.length);
    expect(Array.from(frame.subarray(4))).toEqual(Array.from(json));
  });

  it("refuses a message over the limit with a protocol error", () => {
    expect(() => encodeFrame({ data: "x".repeat(HOST_MESSAGE_LIMIT) })).toThrow(BridgeError);
    try { encodeFrame({ data: "x".repeat(100) }, 10); } catch (error) {
      expect((error as BridgeError).code).toBe("protocol");
    }
  });
});

function frameOf(text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, true);
  frame.set(body, 4);
  return frame;
}

describe("FrameDecoder", () => {
  it("round-trips messages split at any byte and joined in one push", () => {
    const messages = [{ id: 1, op: "hello" }, { id: 2, op: "stat", path: "papers/ä" }];
    const bytes = new Uint8Array([...encodeFrame(messages[0]), ...encodeFrame(messages[1])]);
    for (let cut = 0; cut <= bytes.length; cut += 1) {
      const decoder = new FrameDecoder();
      const first = decoder.push(bytes.subarray(0, cut));
      const second = decoder.push(bytes.subarray(cut));
      expect([...first.messages, ...second.messages]).toEqual(messages);
      expect(first.error ?? second.error).toBeUndefined();
    }
  });

  it("joins a body that arrives one byte per push", () => {
    const decoder = new FrameDecoder();
    const bytes = encodeFrame({ text: "x".repeat(300) });
    const messages = Array.from(bytes, (byte) => decoder.push(new Uint8Array([byte])).messages).flat();
    expect(messages).toEqual([{ text: "x".repeat(300) }]);
  });

  it("refuses a frame announcing more than the limit", () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 2000, true);
    expect(new FrameDecoder(1000).push(header)).toEqual({ messages: [], error: expect.objectContaining({ code: "protocol" }) });
  });

  it("returns the messages before a frame that is not JSON, then stays broken", () => {
    const decoder = new FrameDecoder();
    const bytes = new Uint8Array([...encodeFrame({ id: 1 }), ...frameOf("{nope"), ...encodeFrame({ id: 2 })]);
    const result = decoder.push(bytes);
    expect(result.messages).toEqual([{ id: 1 }]);
    expect(result.error).toBeInstanceOf(BridgeError);
    expect(result.error?.code).toBe("protocol");
    expect(decoder.push(encodeFrame({ id: 3 }))).toEqual({ messages: [] });
  });
});

describe("changedEvents", () => {
  it("returns no event for no paths", () => {
    expect(createChangedEvents([])).toEqual([]);
  });

  it("keeps a small batch in one event", () => {
    expect(createChangedEvents(["papers/a/metadata.yaml", "papers/ä/b.pdf"])).toEqual([
      { event: "changed", paths: ["papers/a/metadata.yaml", "papers/ä/b.pdf"] },
    ]);
  });

  it("splits a batch too large for one frame, keeping every path in order", () => {
    const paths = Array.from({ length: 25_000 }, (_, index) => `papers/ü-${String(index).padStart(6, "0")}-${"x".repeat(40)}/metadata.yaml`);
    const events = createChangedEvents(paths);
    expect(events.length).toBeGreaterThan(1);
    for (const event of events) {
      expect(() => encodeFrame(event)).not.toThrow();
      expect(encodeFrame(event).length - 4).toBeLessThanOrEqual(HOST_MESSAGE_LIMIT);
    }
    expect(events.flatMap((event) => event.paths)).toEqual(paths);
  });
});
