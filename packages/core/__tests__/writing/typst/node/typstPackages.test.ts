/** Verifies Typst package folders, resolution order, safety checks, miss recording and Typst Universe downloads. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { packageLabel, toCompilerPath, typstPackageDirs, TypstPackageStore } from "../../../../src/writing/typst/node/index";
import { cleanupTempDirs, listFiles, makeTempDir } from "../../../support/tempDirs";
import { demoPackageArchive, respond } from "../../../support/typstFixtures";

afterEach(cleanupTempDirs);

const demo = { namespace: "preview", name: "demo-pkg", version: "0.1.0" };

async function makeStore() {
  const data = await makeTempDir();
  const cache = await makeTempDir();
  return { data, cache, store: new TypstPackageStore({ data, cache }) };
}

describe("typstPackageDirs", () => {
  const home = os.homedir();

  it("uses Library folders on macOS", () => {
    expect(typstPackageDirs({}, "darwin")).toEqual({
      data: path.join(home, "Library", "Application Support", "typst", "packages"),
      cache: path.join(home, "Library", "Caches", "typst", "packages"),
    });
  });

  it("uses the XDG folders on Linux, and falls back to ~/.local/share and ~/.cache", () => {
    expect(typstPackageDirs({ XDG_DATA_HOME: "/xd", XDG_CACHE_HOME: "/xc" }, "linux")).toEqual({
      data: path.join("/xd", "typst", "packages"), cache: path.join("/xc", "typst", "packages"),
    });
    expect(typstPackageDirs({}, "linux")).toEqual({
      data: path.join(home, ".local", "share", "typst", "packages"), cache: path.join(home, ".cache", "typst", "packages"),
    });
  });

  it("uses APPDATA and LOCALAPPDATA on Windows", () => {
    expect(typstPackageDirs({ APPDATA: "C:\\Roaming", LOCALAPPDATA: "C:\\Local" }, "win32")).toEqual({
      data: path.join("C:\\Roaming", "typst", "packages"), cache: path.join("C:\\Local", "typst", "packages"),
    });
  });

  it("lets TYPST_PACKAGE_PATH and TYPST_PACKAGE_CACHE_PATH override both folders", () => {
    expect(typstPackageDirs({ TYPST_PACKAGE_PATH: "/d", TYPST_PACKAGE_CACHE_PATH: "/c" }, "darwin")).toEqual({ data: "/d", cache: "/c" });
  });
});

describe("TypstPackageStore resolve", () => {
  it("prefers the data folder over the cache", async () => {
    const { data, cache, store } = await makeStore();
    await fs.mkdir(path.join(data, "preview", "demo-pkg", "0.1.0"), { recursive: true });
    await fs.mkdir(path.join(cache, "preview", "demo-pkg", "0.1.0"), { recursive: true });
    expect(store.resolve(demo)).toBe(toCompilerPath(path.join(data, "preview", "demo-pkg", "0.1.0")));
  });

  it("falls back to the cache", async () => {
    const { cache, store } = await makeStore();
    await fs.mkdir(path.join(cache, "preview", "demo-pkg", "0.1.0"), { recursive: true });
    expect(store.resolve(demo)).toBe(toCompilerPath(path.join(cache, "preview", "demo-pkg", "0.1.0")));
  });

  it("rejects unsafe names and versions without recording them", async () => {
    const { store } = await makeStore();
    expect(store.resolve({ ...demo, name: "../x" })).toBeUndefined();
    expect(store.resolve({ ...demo, version: "1.0" })).toBeUndefined();
    expect(store.resolve({ ...demo, namespace: ".." })).toBeUndefined();
    expect(store.takeMissing()).toEqual([]);
  });

  it("records a missing preview package once, then empties on takeMissing", async () => {
    const { store } = await makeStore();
    expect(store.resolve(demo)).toBeUndefined();
    expect(store.resolve(demo)).toBeUndefined();
    expect(store.takeMissing()).toEqual([demo]);
    expect(store.takeMissing()).toEqual([]);
  });

  it("does not record a missing package from another namespace", async () => {
    const { store } = await makeStore();
    expect(store.resolve({ ...demo, namespace: "local" })).toBeUndefined();
    expect(store.takeMissing()).toEqual([]);
  });
});

describe("TypstPackageStore download", () => {
  it("extracts the archive into the cache and leaves no staging folder", async () => {
    const { cache, store } = await makeStore();
    const archive = await demoPackageArchive();
    const urls: string[] = [];
    await store.download(demo, async (url) => { urls.push(url); return respond(200, archive); });
    expect(urls).toEqual(["https://packages.typst.org/preview/demo-pkg-0.1.0.tar.gz"]);
    expect(await listFiles(path.join(cache, "preview", "demo-pkg"))).toEqual(["0.1.0/lib.typ", "0.1.0/typst.toml"]);
    expect(await fs.readdir(path.join(cache, "preview", "demo-pkg"))).toEqual(["0.1.0"]);
    expect(store.resolve(demo)).toBe(toCompilerPath(path.join(cache, "preview", "demo-pkg", "0.1.0")));
  });

  it("keeps the installed package when another install won the race", async () => {
    const { cache, store } = await makeStore();
    const archive = await demoPackageArchive();
    await store.download(demo, async () => respond(200, archive));
    await store.download(demo, async () => respond(200, archive));
    expect(await fs.readdir(path.join(cache, "preview", "demo-pkg"))).toEqual(["0.1.0"]);
  });

  it("throws that the package does not exist on a 404", async () => {
    const { store } = await makeStore();
    await expect(store.download(demo, async () => respond(404))).rejects.toThrow(`${packageLabel(demo)} does not exist on Typst Universe`);
  });

  it("throws the HTTP status for another failure", async () => {
    const { store } = await makeStore();
    await expect(store.download(demo, async () => respond(503))).rejects.toThrow(/HTTP 503/);
  });

  it("never fetches a non-preview or unsafe package", async () => {
    const { store } = await makeStore();
    const fetchImpl = jest.fn();
    await expect(store.download({ ...demo, namespace: "local" }, fetchImpl)).rejects.toThrow(/not a Typst Universe package/);
    await expect(store.download({ ...demo, name: "../x" }, fetchImpl)).rejects.toThrow(/not a Typst Universe package/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
