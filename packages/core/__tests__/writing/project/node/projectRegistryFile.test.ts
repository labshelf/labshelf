/** Verifies the device-local project registry: its place in the state directory, persistence, corrupt-file protection
 * and atomic writes. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { deviceLocalLayout } from "../../../../src/library/node/index";
import {
  loadProjectRegistry, registerProjectFolder, unregisterProjectFolder,
} from "../../../../src/writing/project/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../support/tempDirs";

const savedStateHome = process.env["XDG_STATE_HOME"];
let stateHome: string;
beforeEach(async () => {
  stateHome = await makeTempDir();
  process.env["XDG_STATE_HOME"] = stateHome;
});
afterEach(async () => {
  if (savedStateHome === undefined) { delete process.env["XDG_STATE_HOME"]; } else { process.env["XDG_STATE_HOME"] = savedStateHome; }
  await cleanupTempDirs();
});

const registryFile = (lib: string) => deviceLocalLayout(lib).projectRegistryPath;
const registryDir = (lib: string) => path.dirname(registryFile(lib));

describe("project registry file", () => {
  it("loads an empty registry when the file is missing", async () => {
    const logger = fakeLogger();
    expect(await loadProjectRegistry(await makeTempDir(), logger)).toEqual({ folders: [] });
    expect(logger.logs).toEqual([]);
  });

  it("keeps the registry in the state directory, never inside the library", async () => {
    const lib = await makeTempDir();
    await registerProjectFolder(lib, "/a", fakeLogger());
    expect(registryFile(lib).startsWith(path.join(stateHome, "labshelf") + path.sep)).toBe(true);
    expect(JSON.parse(await fs.readFile(registryFile(lib), "utf8"))).toEqual({ folders: ["/a"] });
    expect(await listFiles(lib)).toEqual([]);
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

  it("leaves no temp files behind next to the registry", async () => {
    const lib = await makeTempDir();
    const logger = fakeLogger();
    await registerProjectFolder(lib, "/a", logger);
    await registerProjectFolder(lib, "/b", logger);
    await unregisterProjectFolder(lib, "/a", logger);
    expect(await listFiles(registryDir(lib))).toEqual(["projects.json"]);
  });

  it("does not overwrite a corrupt registry when registering or unregistering", async () => {
    const lib = await makeTempDir();
    await fs.mkdir(registryDir(lib), { recursive: true });
    await fs.writeFile(registryFile(lib), "{ not json");
    const logger = fakeLogger();

    await expect(registerProjectFolder(lib, "/a", logger)).rejects.toThrow(/corrupt/);
    await expect(unregisterProjectFolder(lib, "/a", logger)).rejects.toThrow(/corrupt/);
    expect(await fs.readFile(registryFile(lib), "utf8")).toBe("{ not json");
    expect(await listFiles(registryDir(lib))).toEqual(["projects.json"]);
  });

  it("reads a corrupt registry as empty and logs a warning", async () => {
    const lib = await makeTempDir();
    await fs.mkdir(registryDir(lib), { recursive: true });
    await fs.writeFile(registryFile(lib), "[1,2]");
    const logger = fakeLogger();
    expect(await loadProjectRegistry(lib, logger)).toEqual({ folders: [] });
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("keeps unknown keys already in the file", async () => {
    const lib = await makeTempDir();
    await fs.mkdir(registryDir(lib), { recursive: true });
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
