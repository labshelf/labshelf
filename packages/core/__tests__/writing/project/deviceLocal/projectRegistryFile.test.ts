/** Verifies the device-local project registry file: persistence at the given path, corrupt-file protection and no-op writes. */
import * as path from "node:path";

import {
  loadProjectRegistry, createProjectFolderRegistry, registerProjectFolder, removeProjectFolder, type ProjectRegistryFileContext,
} from "../../../../src/writing/project/deviceLocal/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { MemoryLibraryFs } from "../../../support/memoryLibraryFs";

const registryPath = "/state/lib-key/projects.json";

function setup(): { fs: MemoryLibraryFs; ctx: ProjectRegistryFileContext; logger: ReturnType<typeof fakeLogger> } {
  const fs = new MemoryLibraryFs();
  const logger = fakeLogger();
  return { fs, logger, ctx: { fs, paths: path.posix, logger, registryPath } };
}

const saved = async (fs: MemoryLibraryFs): Promise<unknown> => JSON.parse(await fs.readText(registryPath));

describe("project registry file", () => {
  it("loads an empty registry when the file is missing", async () => {
    const { ctx, logger } = setup();
    expect(await loadProjectRegistry(ctx)).toEqual({ folders: [] });
    expect(logger.logs).toEqual([]);
  });

  it("writes the registry at its path and nowhere else", async () => {
    const { fs, ctx } = setup();
    await registerProjectFolder(ctx, "/a");
    expect([...fs.files.keys()]).toEqual([registryPath]);
    expect(await saved(fs)).toEqual({ folders: ["/a"] });
  });

  it("persists registered folders as absolute paths and unregisters them", async () => {
    const { fs, ctx } = setup();
    await registerProjectFolder(ctx, "relative/dir");
    await registerProjectFolder(ctx, "/abs/other");
    await registerProjectFolder(ctx, "/abs/other");
    expect(await saved(fs)).toEqual({ folders: [path.posix.resolve("relative/dir"), "/abs/other"] });
    expect(await loadProjectRegistry(ctx)).toEqual(await saved(fs));

    await removeProjectFolder(ctx, "/abs/other");
    expect((await loadProjectRegistry(ctx)).folders).toEqual([path.posix.resolve("relative/dir")]);
  });

  it("does not overwrite a corrupt registry when registering or unregistering", async () => {
    const { fs, ctx } = setup();
    await fs.writeText(registryPath, "{ not json");
    await expect(registerProjectFolder(ctx, "/a")).rejects.toThrow(/corrupt/);
    await expect(removeProjectFolder(ctx, "/a")).rejects.toThrow(/corrupt/);
    expect(await fs.readText(registryPath)).toBe("{ not json");
  });

  it("reads a corrupt registry as empty and logs a warning", async () => {
    const { fs, ctx, logger } = setup();
    await fs.writeText(registryPath, "[1,2]");
    expect(await loadProjectRegistry(ctx)).toEqual({ folders: [] });
    expect(logger.logs.map((entry) => entry.level)).toEqual(["WARN"]);
  });

  it("keeps unknown keys already in the file", async () => {
    const { fs, ctx } = setup();
    await fs.writeText(registryPath, '{"future":1,"folders":["/x"]}');
    await registerProjectFolder(ctx, "/y");
    expect(await saved(fs)).toEqual({ future: 1, folders: ["/x", "/y"] });
  });

  it("does not rewrite the file when nothing changes", async () => {
    const { fs, ctx } = setup();
    await registerProjectFolder(ctx, "/a");
    const writes = fs.writes;
    await registerProjectFolder(ctx, "/a");
    await removeProjectFolder(ctx, "/never-added");
    expect(fs.writes).toBe(writes);
  });

  it("keeps one registry per library root through the folder registry", async () => {
    const { fs, ctx } = setup();
    const registry = createProjectFolderRegistry(ctx, (root) => `/state${root}/projects.json`);
    await registry.register("/one", "/a");
    await registry.register("/two", "/b");
    expect(await registry.folders("/one")).toEqual(["/a"]);
    await registry.unregister("/two", "/b");
    expect(JSON.parse(await fs.readText("/state/two/projects.json"))).toEqual({ folders: [] });
  });

  it("reads a missing file as empty whatever error the adapter raises for it", async () => {
    // The bridge raises a coded error and the browser store a plain one; neither carries ENOENT.
    const { fs, ctx, logger } = setup();
    fs.readText = async (file) => { throw Object.assign(new Error(`File not found: ${file}`), { code: "notFound" }); };
    expect(await loadProjectRegistry(ctx)).toEqual({ folders: [] });
    expect(logger.logs).toEqual([]);
    await registerProjectFolder(ctx, "/a");
    expect([...fs.files.keys()]).toEqual([registryPath]);
  });

  it("reports a read that fails on an existing file", async () => {
    const { fs, ctx, logger } = setup();
    await fs.writeText(registryPath, '{"folders":[]}');
    fs.readText = async () => { throw new Error("EIO"); };
    expect(await loadProjectRegistry(ctx)).toEqual({ folders: [] });
    expect(logger.errors).toHaveLength(1);
  });
});
