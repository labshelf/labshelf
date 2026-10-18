import type { ILogger } from "@labshelf/core";
import type { ToPageMessage } from "@labshelf/core/helper";

import { createDispatcher, type HelperHandlers } from "../../../src/helper/dispatch/index.js";
import { encodeFrame } from "../stdio/frameCodec.js";

const logs: string[] = [];
const logger = { log: async (_l: string, _m: string, message: string) => { logs.push(message); }, error: async (_m: string, e: unknown) => { logs.push(String(e)); } } as unknown as ILogger;

function setup(handlers: HelperHandlers) {
  const sent: ToPageMessage[] = [];
  const dispatcher = createDispatcher(handlers, (message) => sent.push(message), logger);
  return { sent, dispatcher };
}
const frame = (value: unknown) => encodeFrame(value).subarray(4);

describe("createDispatcher", () => {
  beforeEach(() => { logs.length = 0; });

  it("replies malformed for bad JSON and keeps going", async () => {
    const { sent, dispatcher } = setup({ cancel: async (m, send) => send({ v: 1, id: m.id, type: "need", paths: [] }) });
    dispatcher.accept(Buffer.from("{nope"));
    dispatcher.accept(frame({ v: 1, id: "2", type: "cancel", projectId: "p" }));
    await dispatcher.drain();
    expect(sent[0]).toMatchObject({ type: "error", code: "malformed" });
    expect(sent[1]).toMatchObject({ type: "need", id: "2" });
  });

  it("replies with the parser's code and the request id on a rejected message", async () => {
    const { sent, dispatcher } = setup({});
    dispatcher.accept(frame({ v: 2, id: "5", type: "hello", extensionVersion: "1" }));
    dispatcher.accept(frame({ v: 1, id: "6", type: "hello" }));
    await dispatcher.drain();
    expect(sent).toMatchObject([{ type: "error", id: "5", code: "version" }, { type: "error", id: "6", code: "invalid-field" }]);
  });

  it("replies unknown-type for a valid message with no handler", async () => {
    const { sent, dispatcher } = setup({});
    dispatcher.accept(frame({ v: 1, id: "3", type: "cancel", projectId: "p" }));
    await dispatcher.drain();
    expect(sent).toMatchObject([{ type: "error", id: "3", code: "unknown-type" }]);
  });

  it("answers a throwing handler with an internal error and logs it", async () => {
    const { sent, dispatcher } = setup({ delete: async () => { throw new Error("disk full"); } });
    dispatcher.accept(frame({ v: 1, id: "4", type: "delete", projectId: "p", paths: [] }));
    await dispatcher.drain();
    expect(sent).toMatchObject([{ type: "error", id: "4", code: "internal" }]);
    expect(logs.join("\n")).toContain("disk full");
  });

  it("runs messages in order but lets cancel overtake a running handler", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { dispatcher } = setup({
      build: async () => { order.push("build:start"); await gate; order.push("build:end"); },
      delete: async () => { order.push("delete"); },
      cancel: async () => { order.push("cancel"); release(); },
    });
    dispatcher.accept(frame({ v: 1, id: "1", type: "build", projectId: "p", main: "main.tex", engine: "pdflatex" }));
    dispatcher.accept(frame({ v: 1, id: "2", type: "delete", projectId: "p", paths: [] }));
    dispatcher.accept(frame({ v: 1, id: "3", type: "cancel", projectId: "p" }));
    await dispatcher.drain();
    expect(order).toEqual(["build:start", "cancel", "build:end", "delete"]);
  });
});
