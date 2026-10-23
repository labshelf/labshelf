/** Verifies the merge base store: round trip, location under its folder, no deletion, path rejection. */
import * as path from "node:path";

import { FileProjectVersionStore, textHash } from "../../../src/writing/merge/index";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

const basesDir = "/state/lib-key/merge-bases";

function makeStore() {
  const fs = new MemoryLibraryFs();
  return { fs, store: new FileProjectVersionStore(fs, path.posix, basesDir) };
}

describe("FileProjectVersionStore", () => {
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
    expect([...fs.files.keys()]).toEqual([`${basesDir}/p1/sub/main.tex`, `${basesDir}/p1/.versions/sub/main.tex`]);
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

it('retains the newest twenty texts without promoting an unsuccessful save', async () => {
  const { store } = makeStore();
  await store.remember('p', 'main.tex', 'saved');
  await store.retain('p', 'main.tex', 'unsaved');
  expect(await store.latest('p', 'main.tex')).toBe('saved');
  for (let i = 0; i < 21; i++) await store.remember('p', 'main.tex', `version ${i}`);
  expect(await store.version('p', 'main.tex', await textHash('version 0'))).toBeUndefined();
  expect(await store.version('p', 'main.tex', await textHash('version 1'))).toBe('version 1');
  expect(await store.latest('p', 'main.tex')).toBe('version 20');
});

it('rejects journals with altered text hashes or escaping pending copies', async () => {
  const { fs, store } = makeStore();
  await fs.writeText(`${basesDir}/p/.versions/main.tex`, JSON.stringify({ versions: [{ hash: 'a'.repeat(64), text: 'bad' }] }));
  await expect(store.latest('p', 'main.tex')).rejects.toThrow('Cannot read project versions');
  await expect(async () => store.setPending('p', 'main.tex', '../outside.tex')).rejects.toThrow('Invalid pending conflict path');
});

it('pins the last successful version while retaining twenty failed save attempts', async () => {
  const { store } = makeStore();
  await store.remember('p', 'main.tex', 'saved');
  for (let i = 0; i < 25; i++) await store.retain('p', 'main.tex', `attempt ${i}`);
  expect(await store.latest('p', 'main.tex')).toBe('saved');
});
