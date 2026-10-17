/** Verifies that device-local files of a library resolve outside it, under a per-library key. */
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import * as path from "node:path";

import { deviceLocalLayout, libraryKey } from "../../../../src/library/node/index";
import { sha256Hex } from "../../../../src/hash/index";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

const env = { XDG_CACHE_HOME: "/xdg/cache", XDG_STATE_HOME: "/xdg/state" };

describe("libraryKey", () => {
  afterEach(cleanupTempDirs);

  it("is the first 16 hex chars of the sha256 of the normalised root", async () => {
    const root = await makeTempDir();
    const normalised = realpathSync.native(root);
    const expected = (await sha256Hex(new TextEncoder().encode(normalised))).slice(0, 16);
    expect(libraryKey(root)).toBe(expected);
    expect(libraryKey(root)).toBe(createHash("sha256").update(normalised).digest("hex").slice(0, 16));
  });

  it("hashes the resolved path of a root that does not exist, and tells libraries apart", () => {
    expect(libraryKey("lib")).toBe(libraryKey(path.resolve("lib")));
    expect(libraryKey("/data/lib")).toBe(createHash("sha256").update(path.resolve("/data/lib")).digest("hex").slice(0, 16));
    expect(libraryKey("/data/a")).not.toBe(libraryKey("/data/b"));
  });

  it("gives a symlink and its target one key", async () => {
    const dir = await makeTempDir();
    const target = path.join(dir, "library");
    const link = path.join(dir, "link");
    mkdirSync(target);
    symlinkSync(target, link);
    expect(libraryKey(link)).toBe(libraryKey(target));
  });

  it("gives one key to a Windows root whatever the case of its drive letter", () => {
    expect(libraryKey("c:\\Users\\me\\Library", "win32")).toBe(libraryKey("C:\\Users\\me\\Library", "win32"));
    expect(libraryKey("C:\\Users\\me\\Library", "win32")).toBe(
      createHash("sha256").update("C:\\Users\\me\\Library").digest("hex").slice(0, 16),
    );
  });
});

describe("deviceLocalLayout", () => {
  const key = libraryKey("/data/lib");
  const l = deviceLocalLayout("/data/lib", env);
  const cache = path.join("/xdg/cache", "labshelf", "libraries", key);
  const state = path.join("/xdg/state", "labshelf", "libraries", key);

  it("puts the AI index and the OpenAlex cache in the cache directory", () => {
    expect(l.aiDatabasePath).toBe(path.join(cache, "index.sqlite"));
    expect(l.openAlexCacheDir).toBe(path.join(cache, "openalex"));
  });

  it("puts logs and the project registry in the state directory", () => {
    expect(l.logsDir).toBe(path.join(state, "logs"));
    expect(l.appLogPath).toBe(path.join(state, "logs", "app.log"));
    expect(l.terminalLogPath).toBe(path.join(state, "logs", "terminal.log"));
    expect(l.projectRegistryPath).toBe(path.join(state, "projects.json"));
  });

  it("keeps every path outside the library", () => {
    for (const file of Object.values(l)) { expect(file.startsWith("/data/lib")).toBe(false); }
  });
});
