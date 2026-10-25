/** Verifies that the share list file store reads a missing file as absent, replaces the file whole and runs one section at a time per file. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createFileShareRegistryStore } from "../../../src/share/node/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";

describe("createFileShareRegistryStore", () => {
  afterEach(cleanupTempDirs);

  it("reads a missing file as undefined", async () => {
    const dir = await makeTempDir();
    expect(await createFileShareRegistryStore(path.join(dir, "shares.json")).read()).toBeUndefined();
  });

  it("writes into a folder that does not exist yet and reads the text back, leaving no temp file", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "libraries", "abc", "shares.json");
    const store = createFileShareRegistryStore(file);
    await store.write('{"shares":[]}\n');
    await store.write('{"shares":[1]}\n');
    expect(await store.read()).toBe('{"shares":[1]}\n');
    expect(await fs.readdir(path.dirname(file))).toEqual(["shares.json"]);
  });

  it("passes on a read failure other than a missing file", async () => {
    const dir = await makeTempDir();
    await expect(createFileShareRegistryStore(dir).read()).rejects.toThrow();
  });

  it("runs the exclusive sections of two stores over one file one after the other", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "shares.json");
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = createFileShareRegistryStore(file).exclusive(async () => { order.push("first in"); await gate; order.push("first out"); });
    const second = createFileShareRegistryStore(file).exclusive(async () => { order.push("second"); });
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first in", "first out", "second"]);
  });

  it("runs the next section after one that failed", async () => {
    const dir = await makeTempDir();
    const store = createFileShareRegistryStore(path.join(dir, "shares.json"));
    await expect(store.exclusive(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await store.exclusive(async () => 7)).toBe(7);
  });
});
