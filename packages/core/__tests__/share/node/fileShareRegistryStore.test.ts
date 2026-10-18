/** Verifies that the share list file store reads a missing file as absent and replaces the file whole. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { fileShareRegistryStore } from "../../../src/share/node/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";

describe("fileShareRegistryStore", () => {
  afterEach(cleanupTempDirs);

  it("reads a missing file as undefined", async () => {
    const dir = await makeTempDir();
    expect(await fileShareRegistryStore(path.join(dir, "shares.json")).read()).toBeUndefined();
  });

  it("writes into a folder that does not exist yet and reads the text back, leaving no temp file", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "libraries", "abc", "shares.json");
    const store = fileShareRegistryStore(file);
    await store.write('{"shares":[]}\n');
    await store.write('{"shares":[1]}\n');
    expect(await store.read()).toBe('{"shares":[1]}\n');
    expect(await fs.readdir(path.dirname(file))).toEqual(["shares.json"]);
  });

  it("passes on a read failure other than a missing file", async () => {
    const dir = await makeTempDir();
    await expect(fileShareRegistryStore(dir).read()).rejects.toThrow();
  });
});
