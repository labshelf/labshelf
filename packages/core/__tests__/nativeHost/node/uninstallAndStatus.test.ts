/** Pins what status reports per browser and that uninstall removes only manifests of the install it targets. */
import * as path from "node:path";

import { BRIDGE_HOST_SPEC, installNativeHost, checkNativeHost, uninstallNativeHost } from "../../../src/nativeHost/node/index";
import { cleanupTempDirs, pathExists } from "../../support/tempDirs";
import { env, fakeRegistry, launch, readJson, standaloneBinary } from "./nativeHostHarness";

afterEach(cleanupTempDirs);

describe("nativeHostStatus", () => {
  it("reports presence and what each manifest points at", async () => {
    const e = await env("linux", [".config/google-chrome", ".mozilla"]);
    const before = await checkNativeHost(e, BRIDGE_HOST_SPEC);
    expect(before.browsers.find((b) => b.browser === "chrome")).toMatchObject({ present: true, manifest: "missing" });
    expect(before.browsers.find((b) => b.browser === "edge")).toMatchObject({ present: false, manifest: "missing" });
    const { launcher } = await installNativeHost(e, BRIDGE_HOST_SPEC, launch);
    await installNativeHost(e, BRIDGE_HOST_SPEC, { kind: "binary", path: "/opt/standalone" }).then(() => undefined);
    const after = await checkNativeHost(e, BRIDGE_HOST_SPEC);
    expect(after.browsers.find((b) => b.browser === "chrome")!.manifest).toEqual({ path: "/opt/standalone", kind: "other" });
    await installNativeHost(e, BRIDGE_HOST_SPEC, launch);
    expect((await checkNativeHost(e, BRIDGE_HOST_SPEC)).browsers.find((b) => b.browser === "firefox")!.manifest)
      .toEqual({ path: launcher, kind: "launcher", owner: "vscode" });
  });

  it("checks the registry key on Windows", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome"]);
    const e = await env("win32", [], registry);
    await installNativeHost(e, BRIDGE_HOST_SPEC, launch);
    expect((await checkNativeHost(e, BRIDGE_HOST_SPEC)).browsers[0]!.manifest).toMatchObject({ kind: "launcher" });
    registry.values.clear();
    expect((await checkNativeHost(e, BRIDGE_HOST_SPEC)).browsers[0]!.manifest).toBe("missing");
  });
});

describe("uninstallNativeHost", () => {
  it("removes manifests and the launcher on Linux", async () => {
    const e = await env("linux", [".config/google-chrome", ".mozilla"]);
    const installed = await installNativeHost(e, BRIDGE_HOST_SPEC, launch);
    expect(await uninstallNativeHost(e, BRIDGE_HOST_SPEC)).toEqual({ removed: ["chrome", "firefox"], warnings: [] });
    for (const b of installed.browsers) expect(await pathExists(b.manifestPath)).toBe(false);
    expect(await pathExists(path.dirname(installed.launcher!))).toBe(false);
    expect((await uninstallNativeHost(e, BRIDGE_HOST_SPEC)).removed).toEqual([]);
  });

  it("leaves a manifest that points at a standalone binary", async () => {
    const e = await env("darwin", ["Library/Application Support/Google/Chrome"]);
    const binary = await standaloneBinary(e);
    const { browsers } = await installNativeHost(e, BRIDGE_HOST_SPEC, { kind: "binary", path: binary });
    expect((await uninstallNativeHost(e, BRIDGE_HOST_SPEC)).removed).toEqual([]);
    expect((await readJson(browsers[0]!.manifestPath))["path"]).toBe(binary);
    expect((await uninstallNativeHost(e, BRIDGE_HOST_SPEC, { kind: "binary", path: "/elsewhere" })).removed).toEqual([]);
    expect((await uninstallNativeHost(e, BRIDGE_HOST_SPEC, { kind: "binary", path: binary })).removed).toEqual(["chrome"]);
    expect(await pathExists(browsers[0]!.manifestPath)).toBe(false);
  });

  it("deletes the registry keys on Windows and keeps a binary's manifest in the host folder", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome", "HKCU\\Software\\Mozilla\\Firefox"]);
    const e = await env("win32", [], registry);
    await installNativeHost(e, BRIDGE_HOST_SPEC, launch);
    expect((await uninstallNativeHost(e, BRIDGE_HOST_SPEC)).removed).toEqual(["chrome", "firefox"]);
    expect(registry.values.size).toBe(0);
    expect(await pathExists(path.join(e.home, "AppData/Local/LabShelf/bridge"))).toBe(false);

    const binary = await standaloneBinary(e);
    await installNativeHost(e, BRIDGE_HOST_SPEC, { kind: "binary", path: binary });
    expect((await uninstallNativeHost(e, BRIDGE_HOST_SPEC)).removed).toEqual([]);
    expect(registry.values.size).toBe(2);
    expect(await pathExists(path.join(e.home, "AppData/Local/LabShelf/bridge/chrome.json"))).toBe(true);
  });
});
