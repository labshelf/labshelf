/** The projects namespace: one Drive folder per project id, only the projects present on the device, sources only. */
import { SyncEngine, SyncManifest } from "@labshelf/core";
import type { SyncProject } from "@labshelf/core";
import { MemoryFileSystem, FakeRemoteProvider } from "../../support/syncFakes.js";
import { fakeLogger } from "../../support/fakeLogger.js";

const CLOCK = () => new Date("2026-05-16T00:00:00.000Z");

class Device {
  readonly fs = new MemoryFileSystem();
  readonly logger = fakeLogger();
  manifest!: SyncManifest;

  constructor(readonly remote: FakeRemoteProvider, readonly name: string) {}

  async run(projects?: readonly SyncProject[]) {
    this.manifest = await SyncManifest.load(this.fs, `/${this.name}/manifest.json`, "fake");
    const engine = new SyncEngine({
      provider: this.remote, fs: this.fs, manifest: this.manifest, clock: CLOCK, logger: this.logger,
      roots: { library: `/${this.name}/lib`, appdata: `/${this.name}/app` },
      ...(projects ? { projects } : {}),
    });
    return engine.run();
  }
}

async function driveTree(remote: FakeRemoteProvider, folderId?: string, prefix = ""): Promise<string[]> {
  const parent = folderId ?? (await remote.resolveRoot("projects")).id;
  const paths: string[] = [];
  for (const child of await remote.list(parent)) {
    if (child.isFolder) { paths.push(...await driveTree(remote, child.id, `${prefix}${child.name}/`)); }
    else { paths.push(`${prefix}${child.name}`); }
  }
  return paths.sort();
}

function seedThesis(fs: MemoryFileSystem, root: string): void {
  fs.seed(`${root}/labshelf.yaml`, "id: thesis\n");
  fs.seed(`${root}/main.tex`, "\\documentclass{article}");
  fs.seed(`${root}/sections/intro.tex`, "intro");
  fs.seed(`${root}/.git/HEAD`, "ref");
  fs.seed(`${root}/.labshelf/state.json`, "{}");
  fs.seed(`${root}/.labshelf/versions/.camera-ready.tmp-1/sources/main.tex`, "half");
  fs.seed(`${root}/data/raw/big.csv`, "1,2");
}

const thesis = (root: string): SyncProject => ({ id: "thesis", root, ignore: ["data/raw/**"] });

describe("projects namespace", () => {
  it("uploads the sources of a project to LabShelf Projects/<id>/, reports it as only on Drive on a device without it, then downloads the sources there", async () => {
    const remote = new FakeRemoteProvider();
    const a = new Device(remote, "a");
    seedThesis(a.fs, "/a/thesis");

    const first = await a.run([thesis("/a/thesis")]);

    expect(await driveTree(remote)).toEqual(["thesis/labshelf.yaml", "thesis/main.tex", "thesis/sections/intro.tex"]);
    expect(first.projectsOnlyOnDrive).toEqual([]);
    expect(first.namespaces.find((n) => n.namespace === "projects")?.uploaded).toBe(3);
    expect(a.manifest.paths("projects").sort()).toEqual(["thesis/labshelf.yaml", "thesis/main.tex", "thesis/sections/intro.tex"]);
    expect(a.manifest.rootId("projects")).toBe((await remote.resolveRoot("projects")).id);

    const b = new Device(remote, "b");
    const withoutProject = await b.run([]);
    expect(withoutProject.projectsOnlyOnDrive).toEqual(["thesis"]);
    expect(withoutProject.namespaces.find((n) => n.namespace === "projects")?.downloaded).toBe(0);
    expect(b.fs.paths()).not.toContainEqual(expect.stringContaining("thesis"));

    const withProject = await b.run([{ id: "thesis", root: "/b/work/thesis", ignore: ["data/raw/**"] }]);
    expect(withProject.projectsOnlyOnDrive).toEqual([]);
    expect(b.fs.paths().filter((p) => p.startsWith("/b/work/"))).toEqual([
      "/b/work/thesis/labshelf.yaml", "/b/work/thesis/main.tex", "/b/work/thesis/sections/intro.tex",
    ]);
  });

  it("writes nothing to a project already in sync, downloads no remote .git file and uploads no local one", async () => {
    const remote = new FakeRemoteProvider();
    const a = new Device(remote, "a");
    seedThesis(a.fs, "/a/thesis");
    await a.run([thesis("/a/thesis")]);
    const [folder] = await remote.list((await remote.resolveRoot("projects")).id);
    const git = await remote.createFolder(folder!.id, ".git");
    await remote.upload(git.id, "config", new TextEncoder().encode("remote git"));
    const writeFile = jest.spyOn(a.fs, "writeFile");
    const deleteFile = jest.spyOn(a.fs, "deleteFile");

    const result = await a.run([thesis("/a/thesis")]);

    expect(result.namespaces.find((n) => n.namespace === "projects")).toMatchObject({ uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0 });
    expect(writeFile.mock.calls.filter(([path]) => path.startsWith("/a/thesis"))).toEqual([]);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(a.fs.has("/a/thesis/.git/config")).toBe(false);
    expect(await driveTree(remote)).not.toContain("thesis/.git/HEAD");
  });

  it("keeps the manifest entries and the Drive folder of a project that is no longer in the list", async () => {
    const remote = new FakeRemoteProvider();
    const a = new Device(remote, "a");
    seedThesis(a.fs, "/a/thesis");
    await a.run([thesis("/a/thesis")]);
    const entries = a.manifest.paths("projects").sort();
    const drive = await driveTree(remote);

    const result = await a.run([]);

    expect(result.namespaces.find((n) => n.namespace === "projects")).toMatchObject({ uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0 });
    expect(result.projectsOnlyOnDrive).toEqual(["thesis"]);
    expect(a.manifest.paths("projects").sort()).toEqual(entries);
    expect(await driveTree(remote)).toEqual(drive);
    expect(a.fs.has("/a/thesis/main.tex")).toBe(true);
  });

  it("creates nothing on Drive for an empty list while LabShelf Projects does not exist, and looks the folder up when it does", async () => {
    const remote = new FakeRemoteProvider();
    const createFolder = jest.spyOn(remote, "createFolder");
    const a = new Device(remote, "a");

    const none = await a.run([]);

    expect(none.projectsOnlyOnDrive).toEqual([]);
    expect(await remote.findRoot("projects")).toBeUndefined();
    expect(createFolder).not.toHaveBeenCalled();
    expect(a.manifest.rootId("projects")).toBeUndefined();

    const b = new Device(remote, "b");
    seedThesis(b.fs, "/b/thesis");
    await b.run([thesis("/b/thesis")]);
    expect((await a.run([])).projectsOnlyOnDrive).toEqual(["thesis"]);
  });

  it("does not run the projects namespace when the device supplies no list", async () => {
    const remote = new FakeRemoteProvider();
    const a = new Device(remote, "a");
    seedThesis(a.fs, "/a/thesis");

    const result = await a.run();

    expect(result.namespaces.map((n) => n.namespace)).toEqual(["library", "appdata"]);
    expect(result.projectsOnlyOnDrive).toBeUndefined();
    expect(await driveTree(remote)).toEqual([]);
  });

  it("syncs a changed source in both directions and keeps a conflict's both copies", async () => {
    const remote = new FakeRemoteProvider();
    const a = new Device(remote, "a");
    const b = new Device(remote, "b");
    seedThesis(a.fs, "/a/thesis");
    await a.run([thesis("/a/thesis")]);
    await b.run([thesis("/b/thesis")]);
    expect(b.fs.text("/b/thesis/main.tex")).toBe("\\documentclass{article}");

    a.fs.seed("/a/thesis/main.tex", "edited on a", 5_000_000);
    await a.run([thesis("/a/thesis")]);
    const pulled = await b.run([thesis("/b/thesis")]);

    expect(pulled.namespaces.find((n) => n.namespace === "projects")?.downloaded).toBe(1);
    expect(b.fs.text("/b/thesis/main.tex")).toBe("edited on a");
  });

  it("logs the projects run", async () => {
    const remote = new FakeRemoteProvider();
    const a = new Device(remote, "a");
    seedThesis(a.fs, "/a/thesis");
    await a.run([thesis("/a/thesis")]);
    expect(a.logger.logs).toContainEqual({ level: "INFO", module: "sync/projects", message: "Sync ran the projects namespace" });
  });

  it("skips a project whose id cannot name a Drive folder", async () => {
    const remote = new FakeRemoteProvider();
    const a = new Device(remote, "a");
    a.fs.seed("/a/odd/main.tex", "x");

    await a.run([{ id: "../odd", root: "/a/odd", ignore: [] }]);

    expect(await driveTree(remote)).toEqual([]);
    expect(a.logger.logs.some((l) => l.level === "WARN" && l.module === "sync/projects")).toBe(true);
  });
});
