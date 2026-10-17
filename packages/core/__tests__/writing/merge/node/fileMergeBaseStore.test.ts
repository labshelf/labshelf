/** Verifies the on-disk merge base store: round trip, location outside the library, no deletion, path rejection. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { deviceLocalLayout } from "../../../../src/library/node/index";
import { FileMergeBaseStore } from "../../../../src/writing/merge/node/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

async function makeStore() {
  const library = await makeTempDir();
  const state = await makeTempDir();
  const env = { XDG_STATE_HOME: state, XDG_CACHE_HOME: state };
  return { library, state, store: new FileMergeBaseStore(library, env), layout: deviceLocalLayout(library, env) };
}

describe("FileMergeBaseStore", () => {
  it("reads back what it wrote, including nested paths", async () => {
    const { store } = await makeStore();
    await store.write("p1", "chapters/intro.tex", "hello");
    expect(await store.read("p1", "chapters/intro.tex")).toBe("hello");
    await store.write("p1", "chapters/intro.tex", "second");
    expect(await store.read("p1", "chapters/intro.tex")).toBe("second");
  });

  it("reads undefined for an unknown file or project", async () => {
    const { store } = await makeStore();
    expect(await store.read("p1", "main.tex")).toBeUndefined();
    await store.write("p1", "main.tex", "x");
    expect(await store.read("p2", "main.tex")).toBeUndefined();
  });

  it("keeps a base after the project file is deleted", async () => {
    const { store, library } = await makeStore();
    const projectFile = path.join(library, "main.tex");
    await fs.writeFile(projectFile, "text");
    await store.write("p1", "main.tex", "text");
    await fs.rm(projectFile);
    expect(await store.read("p1", "main.tex")).toBe("text");
  });

  it("stores under the state directory, outside the library", async () => {
    const { store, library, state, layout } = await makeStore();
    await store.write("p1", "sub/main.tex", "text");
    const file = path.join(layout.mergeBasesDir, "p1", "sub", "main.tex");
    expect(layout.mergeBasesDir.startsWith(path.join(state, "labshelf", "libraries"))).toBe(true);
    expect(await fs.readFile(file, "utf8")).toBe("text");
    expect(file.startsWith(library)).toBe(false);
  });

  it.each([
    ["", "main.tex"], ["p1", ""], ["p1", "../main.tex"], ["p1", "a/../../main.tex"], ["p1", "/etc/passwd"],
    ["p1", "C:\\x.tex"], ["../p2", "main.tex"], ["/abs", "main.tex"], ["p1", "..\\main.tex"], ["p1", "sub\\main.tex"], [".", "main.tex"], ["p1", "./main.tex"], ["a/b", "main.tex"],
  ])("rejects project %j with path %j", async (projectId, relativePath) => {
    const { store } = await makeStore();
    await expect(store.write(projectId, relativePath, "x")).rejects.toThrow(/merge base/i);
    await expect(store.read(projectId, relativePath)).rejects.toThrow(/merge base/i);
  });
});
