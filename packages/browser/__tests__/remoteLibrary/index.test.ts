/** Pins the page's Mirror queue (sync runs and edit pulls one at a time) and the edit files over the library file system. */
import { createPageEditFiles, serializeRuns } from "../../src/remoteLibrary";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("serializeRuns", () => {
  it("runs one job at a time and a waiting sync replaces a waiting pull", async () => {
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const queue = serializeRuns({
      run: () => new Promise<void>((resolve) => { calls.push("run"); release = resolve; }),
      pull: async () => { calls.push("pull"); },
    });
    void queue.run();
    void queue.pull();
    void queue.run();
    expect(calls).toEqual(["run"]);
    release?.();
    await flush();
    expect(calls).toEqual(["run", "run"]);
    release?.();
    await flush();
    await queue.pull();
    expect(calls).toEqual(["run", "run", "pull"]);
  });
});

describe("createPageEditFiles", () => {
  function fakeFs() {
    const files = new Map<string, Uint8Array>();
    const dirs: string[] = [];
    return {
      files, dirs,
      fs: {
        stat: async (path: string) => (files.has(path) ? { isFile: true, isDirectory: false, mtimeMs: 0, size: files.get(path)!.length } : undefined),
        readFile: async (path: string) => files.get(path)!,
        writeFile: async (path: string, bytes: Uint8Array) => { files.set(path, bytes); },
        ensureDir: async (path: string) => { dirs.push(path); },
        deleteFile: async (path: string) => { files.delete(path); },
      },
    };
  }

  it("reads undefined for a missing file, creates the parent on write and removes", async () => {
    const t = fakeFs();
    const files = createPageEditFiles(t.fs);
    expect(await files.readBytes("spaces/a/b.json")).toBeUndefined();
    await files.writeBytes("spaces/a/b.json", new Uint8Array([1]));
    expect(t.dirs).toEqual(["spaces/a"]);
    expect(await files.readBytes("spaces/a/b.json")).toEqual(new Uint8Array([1]));
    await files.remove("spaces/a/b.json");
    await files.remove("spaces/a/missing.json");
    expect(t.files.size).toBe(0);
  });
});
