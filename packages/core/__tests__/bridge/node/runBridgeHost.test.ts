/** Pins the host's handshake, its error replies and its lifetime. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BRIDGE_PROTOCOL, encodeFrame } from "../../../src/bridge/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";
import { startBridge } from "./bridgeHarness";

afterEach(cleanupTempDirs);

async function library(): Promise<string> {
  const root = path.join(await makeTempDir(), "library");
  for (const id of ["a", "b"]) {
    await fs.mkdir(path.join(root, "papers", id), { recursive: true });
    await fs.writeFile(path.join(root, "papers", id, "metadata.yaml"), "title: x\n");
  }
  await fs.mkdir(path.join(root, "papers", "no-metadata"));
  return root;
}

describe("runBridgeHost", () => {
  it("answers hello with the protocol, the library root and the paper count", async () => {
    const root = await library();
    const bridge = await startBridge(root);
    expect(await bridge.call({ id: 1, op: "hello", protocol: BRIDGE_PROTOCOL })).toEqual([
      { id: 1, ok: true, result: { protocol: BRIDGE_PROTOCOL, libraryRoot: root, paperCount: 2 } },
    ]);
    await bridge.close();
  });

  it("refuses a hello with another protocol version and stops", async () => {
    const bridge = await startBridge(await library());
    const [reply] = await bridge.call({ id: 1, op: "hello", protocol: BRIDGE_PROTOCOL + 1 });
    expect(reply).toMatchObject({ id: 1, ok: false, error: { code: "protocol" } });
    await expect(bridge.finished).resolves.toBeUndefined();
  });

  it("refuses every op before a successful hello", async () => {
    const bridge = await startBridge(await library());
    expect((await bridge.call({ id: 1, op: "listDir", path: "papers" }))[0]).toMatchObject({ id: 1, ok: false, error: { code: "protocol" } });
    expect((await bridge.hello())[0]).toMatchObject({ ok: true });
    expect((await bridge.call({ id: 2, op: "listDir", path: "papers" }))[0]).toMatchObject({ id: 2, ok: true });
    await bridge.close();
  });

  it("answers the messages before an oversize frame, then one error, then stops", async () => {
    const bridge = await startBridge(await library());
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 0xffffffff, true);
    bridge.sendBytes(new Uint8Array([
      ...encodeFrame({ id: 0, op: "hello", protocol: BRIDGE_PROTOCOL }),
      ...encodeFrame({ id: 1, op: "listDir", path: "papers" }),
      ...header,
    ]));
    expect(await bridge.next((m) => "id" in m && m.id === 0)).toMatchObject({ ok: true });
    expect(await bridge.next((m) => "id" in m && m.id === 1)).toMatchObject({ ok: true });
    expect(await bridge.next((m) => "id" in m && m.id === null)).toMatchObject({ ok: false, error: { code: "protocol" } });
    await expect(bridge.finished).resolves.toBeUndefined();
    bridge.send({ id: 2, op: "listDir", path: "papers" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(Promise.race([bridge.next(() => true), Promise.resolve("none")])).resolves.toBe("none");
  });

  it("answers the messages before a malformed frame, then one error, then stops", async () => {
    const bridge = await startBridge(await library());
    const body = new TextEncoder().encode("{nope");
    const bad = new Uint8Array(4 + body.length);
    new DataView(bad.buffer).setUint32(0, body.length, true);
    bad.set(body, 4);
    bridge.sendBytes(new Uint8Array([...encodeFrame({ id: 0, op: "hello", protocol: BRIDGE_PROTOCOL }), ...bad]));
    expect(await bridge.next((m) => "id" in m && m.id === 0)).toMatchObject({ ok: true });
    expect(await bridge.next((m) => "id" in m && m.id === null)).toMatchObject({ ok: false, error: { code: "protocol" } });
    await expect(bridge.finished).resolves.toBeUndefined();
  });

  it("answers noLibrary when the shared config names no library", async () => {
    const bridge = await startBridge(undefined);
    expect(await bridge.call({ id: 1, op: "hello", protocol: BRIDGE_PROTOCOL })).toEqual([
      expect.objectContaining({ id: 1, ok: false, error: expect.objectContaining({ code: "noLibrary" }) }),
    ]);
    expect((await bridge.call({ id: 2, op: "listDir", path: "papers" }))[0]).toMatchObject({ error: { code: "noLibrary" } });
    await bridge.close();
  });

  it("answers each failure with its error code and keeps serving", async () => {
    const root = await library();
    const bridge = await startBridge(root);
    await bridge.hello();
    expect((await bridge.call({ id: 1, op: "readFile", path: "papers/missing.pdf" }))[0])
      .toMatchObject({ ok: false, error: { code: "notFound" } });
    expect((await bridge.call({ id: 2, op: "readFile", path: "../secret" }))[0])
      .toMatchObject({ ok: false, error: { code: "outsideLibrary" } });
    expect((await bridge.call({ id: 3, op: "explode" }))[0]).toMatchObject({ id: 3, ok: false, error: { code: "protocol" } });
    expect((await bridge.call({ id: 4, op: "commit" }))[0]).toMatchObject({ ok: false, error: { code: "protocol" } });
    await fs.writeFile(path.join(root, "papers", "a", "paper.pdf"), "");
    expect((await bridge.call({ id: 5, op: "listDir", path: "papers/a/paper.pdf" }))[0])
      .toMatchObject({ ok: false, error: { code: "io" } });
    expect((await bridge.call({ id: 6, op: "listDir", path: "papers/a" }))[0])
      .toMatchObject({ ok: true, result: { names: expect.arrayContaining(["metadata.yaml", "paper.pdf"]) } });
    await bridge.close();
  });

  it("answers a message without an id with a protocol error whose id is null", async () => {
    const bridge = await startBridge(await library());
    bridge.send({ op: "hello" });
    expect(await bridge.next(() => true)).toMatchObject({ id: null, ok: false, error: { code: "protocol" } });
    await bridge.close();
  });

  it("resolves when its input closes", async () => {
    const bridge = await startBridge(await library());
    await expect(bridge.close()).resolves.toBeUndefined();
  });
});
