import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../../src/ports/index";
import {
  cacheDir, libraryKey, loadSharedConfig, moveLibrary, sharedConfigPath, stateDir,
} from "../../../../src/library/node/index";
import { cleanupTempDirs, listFiles, makeTempDir, pathExists } from "../../../support/tempDirs";

afterEach(() => {
  jest.restoreAllMocks();
  return cleanupTempDirs();
});

interface Fixture {
  base: string;
  from: string;
  to: string;
  env: NodeJS.ProcessEnv;
  logger: ILogger & { levels: string[]; messages: string[]; errors: string[] };
}

async function fixture(): Promise<Fixture> {
  const base = await makeTempDir();
  const from = path.join(base, "old", "Lib");
  const to = path.join(base, "synced", "LabShelf");
  await fs.mkdir(path.join(from, ".research", "papers"), { recursive: true });
  await fs.mkdir(path.join(from, "papers", "Reviews", "p-2"), { recursive: true });
  await fs.mkdir(path.join(from, "papers", "p-1"), { recursive: true });
  await fs.writeFile(path.join(from, "papers", "p-1", "metadata.yaml"), "title: One\n");
  await fs.writeFile(path.join(from, "papers", "p-1", "paper.pdf"), Buffer.alloc(5000, 7));
  await fs.writeFile(path.join(from, "papers", "Reviews", "p-2", "metadata.yaml"), "title: Two\n");
  await fs.mkdir(path.join(from, "papers", "empty-collection"));
  const env = {
    XDG_CONFIG_HOME: path.join(base, "config"),
    XDG_CACHE_HOME: path.join(base, "cache"),
    XDG_STATE_HOME: path.join(base, "state"),
  };
  const levels: string[] = [];
  const messages: string[] = [];
  const errors: string[] = [];
  const logger = {
    levels, messages, errors,
    log: async (level: string, _m: string, message: string) => { levels.push(level); messages.push(message); },
    error: async (_m: string, error: unknown) => { errors.push(String(error)); },
  } as Fixture["logger"];
  return { base, from, to, env, logger };
}

/** Makes renames of paths inside `root` fail with EXDEV, as a move across volumes does. */
function crossDevice(root: string): void {
  const original = fs.rename.bind(fs);
  jest.spyOn(fs, "rename").mockImplementation(async (source, target) => {
    if (String(source).startsWith(root)) {
      throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
    }
    return original(source, target);
  });
}

describe("moveLibrary", () => {
  it("renames on the same device, updates the shared config and logs", async () => {
    const f = await fixture();
    const before = await listFiles(f.from);
    await moveLibrary(f.from, f.to, { logger: f.logger, env: f.env });
    expect(await pathExists(f.from)).toBe(false);
    expect(await listFiles(f.to)).toEqual(before);
    expect((await loadSharedConfig(sharedConfigPath(f.env))).libraryRoot).toBe(f.to);
    expect(f.logger.messages.some((m) => /move/i.test(m))).toBe(true);
  });

  it("allows an empty target folder, even with empty subfolders", async () => {
    const f = await fixture();
    await fs.mkdir(path.join(f.to, "leftover", "deeper"), { recursive: true });
    await moveLibrary(f.from, f.to, { logger: f.logger, env: f.env });
    expect(await pathExists(path.join(f.to, "papers", "p-1", "metadata.yaml"))).toBe(true);
    expect(await pathExists(path.join(f.to, "leftover"))).toBe(false);
  });

  it("copies, verifies and deletes the source when rename crosses devices", async () => {
    const f = await fixture();
    const before = await listFiles(f.from);
    const pdf = await fs.readFile(path.join(f.from, "papers", "p-1", "paper.pdf"));
    crossDevice(f.from);
    const progress: Array<[number, number]> = [];
    await moveLibrary(f.from, f.to, { logger: f.logger, env: f.env, onProgress: (done, total) => progress.push([done, total]) });
    expect(await pathExists(f.from)).toBe(false);
    expect(await listFiles(f.to)).toEqual(before);
    expect(await fs.readFile(path.join(f.to, "papers", "p-1", "paper.pdf"))).toEqual(pdf);
    expect(await pathExists(path.join(f.to, "papers", "empty-collection"))).toBe(true);
    expect(progress.at(-1)).toEqual([before.length, before.length]);
    expect((await loadSharedConfig(sharedConfigPath(f.env))).libraryRoot).toBe(f.to);
  });

  it("keeps the source and removes the partial target when a copy fails", async () => {
    const f = await fixture();
    const before = await listFiles(f.from);
    crossDevice(f.from);
    const original = fs.copyFile.bind(fs);
    let calls = 0;
    jest.spyOn(fs, "copyFile").mockImplementation(async (source, target, mode) => {
      calls += 1;
      if (calls === 2) { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); }
      return original(source, target, mode);
    });
    await expect(moveLibrary(f.from, f.to, { logger: f.logger, env: f.env })).rejects.toThrow(/disk full/);
    expect(await listFiles(f.from)).toEqual(before);
    expect(await pathExists(f.to)).toBe(false);
    expect((await loadSharedConfig(sharedConfigPath(f.env))).libraryRoot).toBeUndefined();
    expect(f.logger.errors).toHaveLength(1);
  });

  it("detects a corrupted copy by its hash and keeps the source", async () => {
    const f = await fixture();
    crossDevice(f.from);
    const original = fs.copyFile.bind(fs);
    jest.spyOn(fs, "copyFile").mockImplementation(async (source, target, mode) => {
      await original(source, target, mode);
      if (String(source).endsWith("paper.pdf")) { await fs.writeFile(target, Buffer.alloc(5000, 8)); }
    });
    await expect(moveLibrary(f.from, f.to, { logger: f.logger, env: f.env })).rejects.toThrow(/paper\.pdf/);
    expect(await pathExists(path.join(f.from, "papers", "p-1", "paper.pdf"))).toBe(true);
    expect(await pathExists(f.to)).toBe(false);
  });

  it("detects a missing copied file by the file count", async () => {
    const f = await fixture();
    crossDevice(f.from);
    const original = fs.copyFile.bind(fs);
    jest.spyOn(fs, "copyFile").mockImplementation(async (source, target, mode) => {
      await original(source, target, mode);
      if (String(source).endsWith("paper.pdf")) { await fs.rm(target); }
    });
    await expect(moveLibrary(f.from, f.to, { logger: f.logger, env: f.env })).rejects.toThrow();
    expect(await pathExists(path.join(f.from, "papers", "p-1", "paper.pdf"))).toBe(true);
    expect(await pathExists(f.to)).toBe(false);
  });

  describe("refusals touch nothing", () => {
    it("refuses a target inside the source", async () => {
      const f = await fixture();
      const before = await listFiles(f.from);
      await expect(moveLibrary(f.from, path.join(f.from, "papers", "new"), { logger: f.logger, env: f.env })).rejects.toThrow(/inside/);
      expect(await listFiles(f.from)).toEqual(before);
    });

    it("refuses the source itself as target", async () => {
      const f = await fixture();
      await expect(moveLibrary(f.from, f.from, { logger: f.logger, env: f.env })).rejects.toThrow();
    });

    it("refuses a source that is not a library", async () => {
      const f = await fixture();
      const notLibrary = path.join(f.base, "plain");
      await fs.mkdir(notLibrary);
      await fs.writeFile(path.join(notLibrary, "a.txt"), "a");
      await expect(moveLibrary(notLibrary, f.to, { logger: f.logger, env: f.env })).rejects.toThrow(/not a library/);
      expect(await listFiles(notLibrary)).toEqual(["a.txt"]);
    });

    it("refuses a target that holds files", async () => {
      const f = await fixture();
      await fs.mkdir(path.join(f.to, "sub"), { recursive: true });
      await fs.writeFile(path.join(f.to, "sub", "mine.txt"), "mine");
      await expect(moveLibrary(f.from, f.to, { logger: f.logger, env: f.env })).rejects.toThrow(/not empty/);
      expect(await listFiles(f.to)).toEqual(["sub/mine.txt"]);
      expect(await pathExists(path.join(f.from, "papers", "p-1", "metadata.yaml"))).toBe(true);
      expect((await loadSharedConfig(sharedConfigPath(f.env))).libraryRoot).toBeUndefined();
    });
  });

  describe("device-local folders", () => {
    async function seedDeviceLocal(f: Fixture): Promise<{ cache: string; state: string }> {
      const key = libraryKey(f.from);
      const cache = path.join(cacheDir(f.env), "libraries", key);
      const state = path.join(stateDir(f.env), "libraries", key);
      await fs.mkdir(cache, { recursive: true });
      await fs.mkdir(state, { recursive: true });
      await fs.writeFile(path.join(cache, "index.sqlite"), "idx");
      await fs.writeFile(path.join(state, "projects.json"), "[]");
      return { cache, state };
    }

    it("follow the library to its new key", async () => {
      const f = await fixture();
      const old = await seedDeviceLocal(f);
      await moveLibrary(f.from, f.to, { logger: f.logger, env: f.env });
      const key = libraryKey(f.to);
      expect(await pathExists(old.cache)).toBe(false);
      expect(await pathExists(old.state)).toBe(false);
      expect(await fs.readFile(path.join(cacheDir(f.env), "libraries", key, "index.sqlite"), "utf8")).toBe("idx");
      expect(await fs.readFile(path.join(stateDir(f.env), "libraries", key, "projects.json"), "utf8")).toBe("[]");
    });

    it("follow a cross-device move", async () => {
      const f = await fixture();
      await seedDeviceLocal(f);
      crossDevice(f.from);
      await moveLibrary(f.from, f.to, { logger: f.logger, env: f.env });
      const key = libraryKey(f.to);
      expect(await pathExists(path.join(cacheDir(f.env), "libraries", key, "index.sqlite"))).toBe(true);
    });

    it("may be missing", async () => {
      const f = await fixture();
      await moveLibrary(f.from, f.to, { logger: f.logger, env: f.env });
      expect(f.logger.errors).toEqual([]);
    });

    it("stay in place and are logged when they cannot move, without failing the library move", async () => {
      const f = await fixture();
      const old = await seedDeviceLocal(f);
      const blocker = path.join(cacheDir(f.env), "libraries", libraryKey(f.to));
      await fs.mkdir(blocker, { recursive: true });
      await fs.writeFile(path.join(blocker, "stale"), "x");
      await moveLibrary(f.from, f.to, { logger: f.logger, env: f.env });
      expect(await pathExists(path.join(f.to, "papers", "p-1", "metadata.yaml"))).toBe(true);
      expect(await pathExists(path.join(old.cache, "index.sqlite"))).toBe(true);
      expect(f.logger.errors).toHaveLength(1);
    });
  });
});
