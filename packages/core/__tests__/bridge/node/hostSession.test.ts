/** Pins that a failed send never stops the session from answering later requests. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { BRIDGE_PROTOCOL, type HostMessage, BRIDGE_CHUNK_BYTES } from "../../../src/bridge/index";
import { BridgeHostSession } from "../../../src/bridge/node/hostSession";
import type { ILogger } from "../../../src/ports/index";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../support/tempDirs";
import { startBridge, type BridgeHarness } from "./bridgeHarness";

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

describe("stagedWrites", () => {
  afterEach(cleanupTempDirs);

  async function openBridge(): Promise<{ root: string; bridge: BridgeHarness }> {
    const root = path.join(await makeTempDir(), "library");
    await fs.mkdir(path.join(root, "papers"), { recursive: true });
    const bridge = await startBridge(root);
    await bridge.hello();
    return { root, bridge };
  }

  const failureFor = (id: number) => (m: HostMessage): boolean => "ok" in m && m.id === id && !m.ok;
  const PROTOCOL = { ok: false, error: { code: "protocol" } };

  describe("bridge staged writes", () => {
    it("refuses non-canonical chunk data at that chunk and drops the stage", async () => {
      const { root, bridge } = await openBridge();
      bridge.send({ id: 1, op: "writeFile", path: "papers/x.txt" });
      bridge.send({ id: 1, op: "chunk", data: "AB==" });
      expect(await bridge.next(failureFor(1))).toMatchObject(PROTOCOL);
      expect((await bridge.call({ id: 1, op: "commit", size: 1 }))[0]).toMatchObject(PROTOCOL);
      expect(await listFiles(root)).toEqual([]);
      await bridge.close();
    });

    it("refuses a writeFile whose id is already open", async () => {
      const { bridge } = await openBridge();
      bridge.send({ id: 1, op: "writeFile", path: "papers/x.txt" });
      expect((await bridge.call({ id: 1, op: "writeFile", path: "papers/y.txt" }))[0]).toMatchObject(PROTOCOL);
      await bridge.close();
    });

    it("refuses a ninth open write", async () => {
      const { bridge } = await openBridge();
      for (let id = 1; id <= 8; id += 1) { bridge.send({ id, op: "writeFile", path: `papers/${id}.txt` }); }
      expect((await bridge.call({ id: 9, op: "writeFile", path: "papers/9.txt" }))[0]).toMatchObject(PROTOCOL);
      expect(await bridge.call({ id: 8, op: "commit", size: 0 })).toEqual([{ id: 8, ok: true, result: { size: 0 } }]);
      await bridge.close();
    });

    it("refuses a commit whose size differs from the staged bytes and writes nothing", async () => {
      const { root, bridge } = await openBridge();
      bridge.send({ id: 1, op: "writeFile", path: "papers/x.txt" });
      bridge.send({ id: 1, op: "chunk", data: Buffer.from("abc").toString("base64") });
      expect((await bridge.call({ id: 1, op: "commit", size: 4 }))[0]).toMatchObject(PROTOCOL);
      expect(await listFiles(root)).toEqual([]);
      await bridge.close();
    });

    it("refuses staging past 256 MB per session, drops that stage and frees its bytes", async () => {
      const { bridge } = await openBridge();
      const data = Buffer.alloc(BRIDGE_CHUNK_BYTES, 7).toString("base64");
      bridge.send({ id: 1, op: "writeFile", path: "papers/big.bin" });
      for (let i = 0; i <= 512; i += 1) { bridge.send({ id: 1, op: "chunk", data }); }
      expect(await bridge.next(failureFor(1))).toMatchObject(PROTOCOL);
      expect((await bridge.call({ id: 1, op: "commit", size: 0 }))[0]).toMatchObject(PROTOCOL);
      bridge.send({ id: 2, op: "writeFile", path: "papers/small.bin" });
      bridge.send({ id: 2, op: "chunk", data });
      expect(await bridge.call({ id: 2, op: "commit", size: BRIDGE_CHUNK_BYTES })).toEqual([{ id: 2, ok: true, result: { size: BRIDGE_CHUNK_BYTES } }]);
      await bridge.close();
    }, 30_000);
  });
});
