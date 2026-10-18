import { createLspFrameParser, encodeLspFrame } from "../../../../../src/writing/helper/node/lsp/lspFraming.js";

function collect() {
  const messages: unknown[] = [];
  const invalid: string[] = [];
  return { messages, invalid, feed: createLspFrameParser((m) => messages.push(m), (r) => invalid.push(r)) };
}

describe("LSP framing", () => {
  it("decodes one message", () => {
    const { messages, feed } = collect();
    feed(encodeLspFrame({ id: 1 }));
    expect(messages).toEqual([{ id: 1 }]);
  });

  it("decodes a message split mid-header and mid-body", () => {
    const { messages, feed } = collect();
    const frame = encodeLspFrame({ method: "x", params: { a: "hello world" } });
    feed(frame.subarray(0, 8));
    feed(frame.subarray(8, frame.length - 5));
    expect(messages).toEqual([]);
    feed(frame.subarray(frame.length - 5));
    expect(messages).toEqual([{ method: "x", params: { a: "hello world" } }]);
  });

  it("decodes two messages in one chunk", () => {
    const { messages, feed } = collect();
    feed(Buffer.concat([encodeLspFrame({ n: 1 }), encodeLspFrame({ n: 2 })]));
    expect(messages).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("counts the Content-Length in bytes for multi-byte text", () => {
    const frame = encodeLspFrame({ t: "é日本😀" });
    const header = frame.subarray(0, frame.indexOf("\r\n\r\n")).toString("ascii");
    expect(Number(/\d+/.exec(header)![0])).toBe(frame.length - header.length - 4);
    const { messages, feed } = collect();
    feed(frame.subarray(0, frame.length - 3));
    feed(frame.subarray(frame.length - 3));
    expect(messages).toEqual([{ t: "é日本😀" }]);
  });

  it("reports a frame without Content-Length and a body that is not JSON, then keeps going", () => {
    const { messages, invalid, feed } = collect();
    feed(Buffer.from("X-Other: 1\r\n\r\n"));
    feed(Buffer.from("Content-Length: 3\r\n\r\nabc"));
    feed(encodeLspFrame({ ok: true }));
    expect(invalid).toHaveLength(2);
    expect(messages).toEqual([{ ok: true }]);
  });
});
