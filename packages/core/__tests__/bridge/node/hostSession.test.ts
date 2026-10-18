/** Pins that a failed send never stops the session from answering later requests. */
import { BRIDGE_PROTOCOL, type HostMessage } from "../../../src/bridge/index";
import { BridgeHostSession } from "../../../src/bridge/node/hostSession";
import type { ILogger } from "../../../src/ports/index";

const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } as unknown as ILogger;

describe("BridgeHostSession", () => {
  it("keeps answering after a send fails like a closed pipe", async () => {
    const sent: HostMessage[] = [];
    let calls = 0;
    const send = async (message: HostMessage): Promise<void> => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      sent.push(message);
    };
    const session = new BridgeHostSession({ files: undefined, openLibrary: jest.fn(), send, logger, close: jest.fn() });
    await expect(session.receive({ id: 1, op: "hello", protocol: BRIDGE_PROTOCOL })).resolves.toBeUndefined();
    await session.receive({ id: 2, op: "listDir", path: "papers" });
    expect(sent).toEqual([expect.objectContaining({ id: 2, ok: false, error: expect.objectContaining({ code: "noLibrary" }) })]);
  });
});
