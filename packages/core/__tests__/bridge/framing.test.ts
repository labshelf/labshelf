/** Pins Native Messaging framing: a 4-byte little-endian length, then UTF-8 JSON. */
import { BridgeError, encodeFrame, FrameDecoder, HOST_MESSAGE_LIMIT } from "../../src/bridge/index";

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
