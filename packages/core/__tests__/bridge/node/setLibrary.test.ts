/** Pins the bridge op that lets the browser choose the library folder when the host has none. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BRIDGE_PROTOCOL } from "../../../src/bridge/index";
import { loadSharedConfig, updateSharedConfig } from "../../../src/library/node/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";
import { startBridge } from "./bridgeHarness";

afterEach(cleanupTempDirs);

async function library(): Promise<string> {
  const root = path.join(await makeTempDir(), "library");
  await fs.mkdir(path.join(root, "papers", "a"), { recursive: true });
  await fs.writeFile(path.join(root, "papers", "a", "metadata.yaml"), "title: x\n");
  return root;
}

describe("setLibrary", () => {
  it("writes the shared config, keeps its other keys and serves the folder afterwards", async () => {
    const root = await library();
    const bridge = await startBridge(undefined);
    await updateSharedConfig({ theme: "dark" }, bridge.configFile);
    expect((await bridge.hello())[0]).toMatchObject({ ok: false, error: { code: "noLibrary" } });
    expect(await bridge.call({ id: 1, op: "setLibrary", root })).toEqual([
      { id: 1, ok: true, result: { libraryRoot: root, paperCount: 1 } },
    ]);
    expect(await loadSharedConfig(bridge.configFile)).toMatchObject({ libraryRoot: root, theme: "dark" });
    expect((await bridge.call({ id: 2, op: "listDir", path: "papers" }))[0]).toMatchObject({ ok: true, result: { names: ["a"] } });
    await bridge.close();
  });

  it("refuses when a library is already set and leaves the config alone", async () => {
    const root = await library();
    const other = await library();
    const bridge = await startBridge(root);
    await bridge.hello();
    expect((await bridge.call({ id: 1, op: "setLibrary", root: other }))[0])
      .toMatchObject({ ok: false, error: { code: "protocol", message: "A library is already set" } });
    expect((await loadSharedConfig(bridge.configFile)).libraryRoot).toBe(root);
    await bridge.close();
  });

  it("answers noLibrary for a folder that does not exist or is a file", async () => {
    const root = await library();
    const bridge = await startBridge(undefined);
    await bridge.hello();
    const missing = path.join(root, "nope");
    expect((await bridge.call({ id: 1, op: "setLibrary", root: missing }))[0])
      .toMatchObject({ ok: false, error: { code: "noLibrary", message: expect.stringContaining(missing) } });
    const file = path.join(root, "papers", "a", "metadata.yaml");
    expect((await bridge.call({ id: 2, op: "setLibrary", root: file }))[0]).toMatchObject({ ok: false, error: { code: "noLibrary" } });
    expect((await loadSharedConfig(bridge.configFile)).libraryRoot).toBeUndefined();
    await bridge.close();
  });

  it("refuses before hello", async () => {
    const bridge = await startBridge(undefined);
    expect((await bridge.call({ id: 1, op: "setLibrary", root: await library() }))[0])
      .toMatchObject({ ok: false, error: { code: "protocol" } });
    expect((await loadSharedConfig(bridge.configFile)).libraryRoot).toBeUndefined();
    await bridge.close();
  });

  it("refuses a protocol 1 hello and stops", async () => {
    const bridge = await startBridge(undefined);
    expect(BRIDGE_PROTOCOL).toBe(2);
    expect((await bridge.call({ id: 1, op: "hello", protocol: 1 }))[0]).toMatchObject({ ok: false, error: { code: "protocol" } });
    await expect(bridge.finished).resolves.toBeUndefined();
  });
});
