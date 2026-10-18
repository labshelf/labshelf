/** Pins binary launches, the standalone-host guard of script installs, and that two hosts share a home without colliding. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BRIDGE_HOST_SPEC, HELPER_HOST_SPEC, installNativeHost, uninstallNativeHost } from "../../../../src/nativeHost/node/index";
import { cleanupTempDirs, pathExists } from "../../../support/tempDirs";
import { env, fakeRegistry, launch, readJson, standaloneBinary } from "./nativeHostHarness";

afterEach(cleanupTempDirs);

const CHROME = "Library/Application Support/Google/Chrome";
const helperManifest = (home: string) => path.join(home, CHROME, "NativeMessagingHosts", `${HELPER_HOST_SPEC.hostName}.json`);

describe("binary launch", () => {
  it("points manifests at the binary, writes no launcher and overwrites a script install", async () => {
    const e = await env("darwin", [CHROME]);
    await installNativeHost(e, HELPER_HOST_SPEC, launch);
    const binary = await standaloneBinary(e);
    const result = await installNativeHost(e, HELPER_HOST_SPEC, { kind: "binary", path: binary });
    expect(result.launcher).toBeUndefined();
    expect((await readJson(helperManifest(e.home)))["path"]).toBe(binary);
  });
});

describe("script install next to a standalone host", () => {
  it("leaves the standalone manifest and writes nothing", async () => {
    const e = await env("darwin", [CHROME]);
    const binary = await standaloneBinary(e);
    await installNativeHost(e, HELPER_HOST_SPEC, { kind: "binary", path: binary });
    const result = await installNativeHost(e, HELPER_HOST_SPEC, launch);
    expect(result).toMatchObject({ standalone: binary, browsers: [] });
    expect(result.launcher).toBeUndefined();
    expect((await readJson(helperManifest(e.home)))["path"]).toBe(binary);
    expect(await pathExists(path.join(e.home, ".config/labshelf/helper"))).toBe(false);
  });

  it("takes over with replaceStandalone", async () => {
    const e = await env("darwin", [CHROME]);
    await installNativeHost(e, HELPER_HOST_SPEC, { kind: "binary", path: await standaloneBinary(e) });
    const result = await installNativeHost(e, HELPER_HOST_SPEC, launch, { replaceStandalone: true });
    expect((await readJson(helperManifest(e.home)))["path"]).toBe(result.launcher);
  });

  it("overwrites a manifest whose target no longer exists", async () => {
    const e = await env("darwin", [CHROME]);
    await installNativeHost(e, HELPER_HOST_SPEC, { kind: "binary", path: "/gone/helper" });
    const result = await installNativeHost(e, HELPER_HOST_SPEC, launch);
    expect(result.standalone).toBeUndefined();
    expect((await readJson(helperManifest(e.home)))["path"]).toBe(result.launcher);
  });
});

describe("bridge and helper in one home", () => {
  it("keep separate launchers and manifests on macOS", async () => {
    const e = await env("darwin", [CHROME]);
    const bridge = await installNativeHost(e, BRIDGE_HOST_SPEC, launch);
    const helper = await installNativeHost(e, HELPER_HOST_SPEC, { ...launch, hostScript: "/opt/helper.js" });
    expect(bridge.launcher).toBe(path.join(e.home, ".config/labshelf/bridge/labshelf-bridge"));
    expect(helper.launcher).toBe(path.join(e.home, ".config/labshelf/helper/labshelf-helper"));
    await uninstallNativeHost(e, HELPER_HOST_SPEC);
    expect(await pathExists(bridge.browsers[0]!.manifestPath)).toBe(true);
    expect(await pathExists(bridge.launcher!)).toBe(true);
  });

  it("keep separate manifests and registry keys on Windows", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome"]);
    const e = await env("win32", [], registry);
    const bridge = await installNativeHost(e, BRIDGE_HOST_SPEC, launch);
    const helper = await installNativeHost(e, HELPER_HOST_SPEC, launch);
    expect(bridge.browsers[0]!.manifestPath).toBe(path.join(e.home, "AppData/Local/LabShelf/bridge/chrome.json"));
    expect(helper.browsers[0]!.manifestPath).toBe(path.join(e.home, "AppData/Local/LabShelf/helper/chrome.json"));
    expect(registry.values.size).toBe(2);
    await uninstallNativeHost(e, HELPER_HOST_SPEC);
    expect([...registry.values.keys()]).toEqual([`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${BRIDGE_HOST_SPEC.hostName}`]);
    expect(await fs.readFile(bridge.browsers[0]!.manifestPath, "utf8")).toContain(bridge.launcher!.replace(/\\/g, "\\\\"));
  });
});
