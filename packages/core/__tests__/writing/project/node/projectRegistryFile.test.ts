/** Verifies the on-disk project registry: persistence, corrupt-file protection and atomic writes. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  loadProjectRegistry, registerProjectFolder, unregisterProjectFolder,
} from "../../../../src/writing/project/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const registryFile = (lib: string) => path.join(lib, ".research", "projects.json");

describe("project registry file", () => {
  it("loads an empty registry when the file is missing", async () => {
    const logger = fakeLogger();
    expect(await loadProjectRegistry(await makeTempDir(), logger)).toEqual({ folders: [] });
    expect(logger.logs).toEqual([]);
  });

  it("persists registered folders as absolute paths and unregisters them", async () => {
    const lib = await makeTempDir();
    const logger = fakeLogger();
    await registerProjectFolder(lib, "relative/dir", logger);
    await registerProjectFolder(lib, "/abs/other", logger);
    await registerProjectFolder(lib, "/abs/other", logger);
    const saved = JSON.parse(await fs.readFile(registryFile(lib), "utf8")) as { folders: string[] };
    expect(saved.folders).toEqual([path.resolve("relative/dir"), "/abs/other"]);
    expect(await loadProjectRegistry(lib, logger)).toEqual(saved);

    await unregisterProjectFolder(lib, "/abs/other", logger);
    expect((await loadProjectRegistry(lib, logger)).folders).toEqual([path.resolve("relative/dir")]);
  });

  it("leaves no temp files behind in .research", async () => {
    const lib = await makeTempDir();
    const logger = fakeLogger();
    await registerProjectFolder(lib, "/a", logger);
    await registerProjectFolder(lib, "/b", logger);
    await unregisterProjectFolder(lib, "/a", logger);
    expect(await listFiles(path.join(lib, ".research"))).toEqual(["projects.json"]);
  });

  it("does not overwrite a corrupt registry when registering or unregistering", async () => {
    const lib = await makeTempDir();
    await fs.mkdir(path.join(lib, ".research"), { recursive: true });
    await fs.writeFile(registryFile(lib), "{ not json");
    const logger = fakeLogger();

    await expect(registerProjectFolder(lib, "/a", logger)).rejects.toThrow(/corrupt/);
    await expect(unregisterProjectFolder(lib, "/a", logger)).rejects.toThrow(/corrupt/);
    expect(await fs.readFile(registryFile(lib), "utf8")).toBe("{ not json");
    expect(await listFiles(path.join(lib, ".research"))).toEqual(["projects.json"]);
  });

  it("reads a corrupt registry as empty and logs a warning", async () => {
    const lib = await makeTempDir();
    await fs.mkdir(path.join(lib, ".research"), { recursive: true });
    await fs.writeFile(registryFile(lib), "[1,2]");
    const logger = fakeLogger();
    expect(await loadProjectRegistry(lib, logger)).toEqual({ folders: [] });
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("keeps unknown keys already in the file", async () => {
    const lib = await makeTempDir();
    await fs.mkdir(path.join(lib, ".research"), { recursive: true });
    await fs.writeFile(registryFile(lib), '{"future":1,"folders":["/x"]}');
    await registerProjectFolder(lib, "/y", fakeLogger());
    expect(JSON.parse(await fs.readFile(registryFile(lib), "utf8"))).toEqual({ future: 1, folders: ["/x", "/y"] });
  });

  it("does not rewrite the file when nothing changes", async () => {
    const lib = await makeTempDir();
    const logger = fakeLogger();
    await registerProjectFolder(lib, "/a", logger);
    const before = logger.logs.length;
    await registerProjectFolder(lib, "/a", logger);
    await unregisterProjectFolder(lib, "/never-added", logger);
    expect(logger.logs.length).toBe(before);
  });
});
