/** Pins request validation, protocol version checks and file chunking of the bridge protocol. */
import {
  assertSameProtocol, BRIDGE_CHUNK_BYTES, BRIDGE_PROTOCOL, parseBridgeRequest, splitFileChunks,
} from "../../src/bridge/index";

describe("parseBridgeRequest", () => {
  it("accepts every op with its fields", () => {
    expect(parseBridgeRequest({ id: 1, op: "hello", protocol: 1 })).toEqual({ id: 1, op: "hello", protocol: 1 });
    expect(parseBridgeRequest({ id: 2, op: "rename", from: "a", to: "b" })).toEqual({ id: 2, op: "rename", from: "a", to: "b" });
    expect(parseBridgeRequest({ id: 3, op: "chunk", data: "AA==" })).toEqual({ id: 3, op: "chunk", data: "AA==" });
    expect(parseBridgeRequest({ id: 4, op: "commit", size: 0 })).toEqual({ id: 4, op: "commit", size: 0 });
    expect(parseBridgeRequest({ id: 5, op: "listDir", path: "" })).toEqual({ id: 5, op: "listDir", path: "" });
  });

  it.each([
    ["no id", { op: "stat", path: "a" }],
    ["unknown op", { id: 1, op: "format" }],
    ["missing path", { id: 1, op: "stat" }],
    ["non-string path", { id: 1, op: "readFile", path: 3 }],
    ["missing rename target", { id: 1, op: "rename", from: "a" }],
    ["not an object", "hello"],
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
