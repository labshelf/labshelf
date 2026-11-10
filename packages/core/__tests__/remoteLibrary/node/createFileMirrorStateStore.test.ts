/** Verifies the VS Code mirror table store: a missing file reads as undefined, writes read back, clear removes the file. */
import * as path from "node:path";

import { createDeviceLocalLayout } from "../../../src/library/node/index";
import { parseMirrorState, serializeMirrorState, type MirrorState } from "../../../src/remoteLibrary/mirrorState";
import { createFileMirrorStateStore } from "../../../src/remoteLibrary/node/createFileMirrorStateStore";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";

const state: MirrorState = {
  version: 2,
  generation: "gen-1",
  rows: { "index/papers.json": { hash: "c".repeat(64), size: 10, kind: "papers" } },
};

function memoryFs() {
  const files = new Map<string, string>();
  return {
    files,
    io: {
      readText: async (file: string) => files.get(file),
      writeText: async (file: string, text: string) => { files.set(file, text); },
      remove: async (file: string) => { files.delete(file); },
    },
  };
}

describe("createFileMirrorStateStore", () => {
  it("3.1c reads undefined when the file is missing", async () => {
    const { io } = memoryFs();
    expect(await createFileMirrorStateStore("/state/mirror.json", io).read()).toBeUndefined();
  });

  it("3.1c writes the serialized table to the given file and reads it back", async () => {
    const { io, files } = memoryFs();
    const store = createFileMirrorStateStore("/state/mirror.json", io);
    await store.write(state);
    expect(parseMirrorState(files.get("/state/mirror.json") ?? "")).toEqual(state);
    expect(await store.read()).toEqual(state);
  });

  it("3.1c replaces the previous table on a second write", async () => {
    const { io } = memoryFs();
    const store = createFileMirrorStateStore("/state/mirror.json", io);
    await store.write(state);
    const next: MirrorState = { ...state, rows: {} };
    await store.write(next);
    expect(await store.read()).toEqual(next);
  });

  it("3.1c reads undefined when the file holds text that does not parse", async () => {
    const { io, files } = memoryFs();
    files.set("/state/mirror.json", "{truncated");
    expect(await createFileMirrorStateStore("/state/mirror.json", io).read()).toBeUndefined();
  });

  it("3.1c reads a table written by serializeMirrorState", async () => {
    const { io, files } = memoryFs();
    files.set("/state/mirror.json", serializeMirrorState(state));
    expect(await createFileMirrorStateStore("/state/mirror.json", io).read()).toEqual(state);
  });

  it("3.1c clear removes the file so the next read is undefined", async () => {
    const { io, files } = memoryFs();
    const store = createFileMirrorStateStore("/state/mirror.json", io);
    await store.write(state);
    await store.clear();
    expect(files.has("/state/mirror.json")).toBe(false);
    expect(await store.read()).toBeUndefined();
  });

  it("3.1c clear on a missing file does not throw", async () => {
    const { io } = memoryFs();
    await expect(createFileMirrorStateStore("/state/mirror.json", io).clear()).resolves.toBeUndefined();
  });
});

describe("device-local layout", () => {
  afterEach(cleanupTempDirs);

  it("3.1d exposes a mirror.json path beside the other state files under the library key", async () => {
    const root = await makeTempDir();
    const layout = createDeviceLocalLayout(root, { XDG_CACHE_HOME: "/xdg/cache", XDG_STATE_HOME: "/xdg/state" });
    const expected = path.join(path.dirname(layout.shareRegistryPath), "mirror.json");
    expect(Object.values(layout)).toContain(expected);
    expect(expected.startsWith(path.join("/xdg/state", "labshelf", "libraries"))).toBe(true);
  });

  it("3.1d gives each library its own mirror.json path", async () => {
    const a = await makeTempDir();
    const b = await makeTempDir();
    const env = { XDG_CACHE_HOME: "/xdg/cache", XDG_STATE_HOME: "/xdg/state" };
    const paths = [a, b].map((root) => Object.values(createDeviceLocalLayout(root, env))
      .filter((value) => typeof value === "string" && path.basename(value) === "mirror.json"));
    expect(paths[0]).toHaveLength(1);
    expect(paths[1]).toHaveLength(1);
    expect(paths[0]).not.toEqual(paths[1]);
  });
});
