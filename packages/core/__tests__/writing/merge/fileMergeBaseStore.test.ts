/** Verifies the merge base store: round trip, location under its folder, no deletion, path rejection. */
import * as path from "node:path";

import { FileMergeBaseStore } from "../../../src/writing/merge/index";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const basesDir = "/state/lib-key/merge-bases";

function makeStore() {
  const fs = new MemoryLibraryFs();
  return { fs, store: new FileMergeBaseStore(fs, path.posix, basesDir) };
}

describe("FileMergeBaseStore", () => {
  it("reads back what it wrote, including nested paths", async () => {
    const { store } = makeStore();
    await store.write("p1", "chapters/intro.tex", "hello");
    expect(await store.read("p1", "chapters/intro.tex")).toBe("hello");
    await store.write("p1", "chapters/intro.tex", "second");
    expect(await store.read("p1", "chapters/intro.tex")).toBe("second");
  });

  it("reads undefined for an unknown file or project", async () => {
    const { store } = makeStore();
    expect(await store.read("p1", "main.tex")).toBeUndefined();
    await store.write("p1", "main.tex", "x");
    expect(await store.read("p2", "main.tex")).toBeUndefined();
  });

  it("keeps a base after the project file is deleted", async () => {
    const { fs, store } = makeStore();
    await fs.writeText("/lib/main.tex", "text");
    await store.write("p1", "main.tex", "text");
    await fs.removeTree("/lib/main.tex");
    expect(await store.read("p1", "main.tex")).toBe("text");
  });

  it("stores under its folder, one segment per path part", async () => {
    const { fs, store } = makeStore();
    await store.write("p1", "sub/main.tex", "text");
    expect([...fs.files.keys()]).toEqual([`${basesDir}/p1/sub/main.tex`]);
  });

  it.each([
    ["", "main.tex"], ["p1", ""], ["p1", "../main.tex"], ["p1", "a/../../main.tex"], ["p1", "/etc/passwd"],
    ["p1", "C:\\x.tex"], ["../p2", "main.tex"], ["/abs", "main.tex"], ["p1", "..\\main.tex"], ["p1", "sub\\main.tex"], [".", "main.tex"], ["p1", "./main.tex"], ["a/b", "main.tex"],
  ])("rejects project %j with path %j", async (projectId, relativePath) => {
    const { store } = makeStore();
    await expect(store.write(projectId, relativePath, "x")).rejects.toThrow(/merge base/i);
    await expect(store.read(projectId, relativePath)).rejects.toThrow(/merge base/i);
  });
});
