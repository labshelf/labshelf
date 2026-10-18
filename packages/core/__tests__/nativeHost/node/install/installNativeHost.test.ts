/**
 * Pins where the native-host installer writes host manifests and the launcher, per browser and OS.
 * Locations: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 * and https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BRIDGE_HOST_NAME } from "../../../../src/bridge/index";
import { BRIDGE_HOST_SPEC, installNativeHost, type HostLaunch, type NativeHostEnv } from "../../../../src/nativeHost/node/index";
import { cleanupTempDirs, makeTempDir, pathExists } from "../../../support/tempDirs";
import { CHROME_ID, env, fakeRegistry, launch, logsOf, readJson } from "./nativeHostHarness";

afterEach(cleanupTempDirs);

const installBridge = (e: NativeHostEnv, l: HostLaunch) => installNativeHost(e, BRIDGE_HOST_SPEC, l);

describe("installNativeHost on macOS", () => {
  it("writes a Chrome manifest with allowed_origins and an executable sh launcher", async () => {
    const e = await env("darwin", ["Library/Application Support/Google/Chrome"]);
    const result = await installBridge(e, launch);

    const manifestPath = path.join(e.home, "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`);
    const launcher = path.join(e.home, ".config/labshelf/bridge/labshelf-bridge");
    expect(result).toEqual({ launcher, browsers: [{ browser: "chrome", label: "Google Chrome", manifestPath }], warnings: [] });
    expect(await readJson(path.join(e.home, ".config/labshelf/bridge/host.json"))).toEqual({ owner: "vscode", nodePath: launch.nodePath, hostScript: launch.hostScript, electronRunAsNode: false });
    expect(await readJson(manifestPath)).toEqual({
      name: "app.labshelf.bridge",
      description: expect.any(String),
      path: launcher,
      type: "stdio",
      allowed_origins: [`chrome-extension://${CHROME_ID}/`],
    });
    expect((await fs.stat(launcher)).mode & 0o111).not.toBe(0);
    const script = await fs.readFile(launcher, "utf8");
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain(`exec '/opt/node bin/node' '/opt/labshelf/bridge-host.js' "$@"`);
    expect(script).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("writes Firefox, Chromium and Brave manifests in their Application Support folders", async () => {
    // Firefox keeps its profiles in .../Firefox; the Mozilla folder only exists once a host manifest is written.
    const e = await env("darwin", [
      "Library/Application Support/Firefox",
      "Library/Application Support/Chromium",
      "Library/Application Support/BraveSoftware/Brave-Browser",
    ]);
    const result = await installBridge(e, launch);

    expect(result.browsers.map((b) => b.browser).sort()).toEqual(["brave", "chromium", "firefox"]);
    const firefox = await readJson(path.join(e.home, "Library/Application Support/Mozilla/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`));
    expect(firefox["allowed_extensions"]).toEqual(["labshelf@lucanaasser.dev"]);
    expect(firefox["allowed_origins"]).toBeUndefined();
    expect(await pathExists(path.join(e.home, "Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`))).toBe(true);
  });

  it("sets ELECTRON_RUN_AS_NODE when the launcher runs an Electron binary", async () => {
    const e = await env("darwin", ["Library/Application Support/Google/Chrome"]);
    const result = await installBridge(e, { ...launch, nodePath: "/Apps/Code's/Electron", electronRunAsNode: true });
    const script = await fs.readFile(result.launcher!, "utf8");
    expect(script).toContain(`ELECTRON_RUN_AS_NODE=1 exec '/Apps/Code'\\''s/Electron'`);
  });

  it("sets up no browser when none is installed", async () => {
    const e = await env("darwin");
    expect((await installBridge(e, launch)).browsers).toEqual([]);
  });
});

describe("installNativeHost on Linux", () => {
  it("writes manifests in the XDG folders of Chrome, Chromium, Brave and in ~/.mozilla", async () => {
    const e = await env("linux", [".config/google-chrome", ".config/chromium", ".config/BraveSoftware/Brave-Browser", ".mozilla"]);
    const result = await installBridge(e, launch);

    expect(result.browsers.map((b) => b.manifestPath).sort()).toEqual([
      path.join(e.home, ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`),
      path.join(e.home, ".config/chromium/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`),
      path.join(e.home, ".config/google-chrome/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`),
      path.join(e.home, ".mozilla/native-messaging-hosts", `${BRIDGE_HOST_NAME}.json`),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("writes Edge and Vivaldi manifests and honours XDG_CONFIG_HOME for Chromium-family browsers", async () => {
    const e = await env("linux", ["xdg/microsoft-edge", "xdg/vivaldi", ".config/chromium"]);
    const result = await installBridge({ ...e, configHome: path.join(e.home, "xdg") }, launch);
    expect(result.browsers.map((b) => b.manifestPath)).toEqual([
      path.join(e.home, "xdg/microsoft-edge/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`),
      path.join(e.home, "xdg/vivaldi/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`),
    ]);
  });

  it("ignores an empty XDG_CONFIG_HOME", async () => {
    const e = await env("linux", [".config/vivaldi"]);
    expect((await installBridge({ ...e, configHome: "" }, launch)).browsers.map((b) => b.browser)).toEqual(["vivaldi"]);
  });

  it("warns about Flatpak and Snap browsers instead of failing", async () => {
    const e = await env("linux", [".var/app/com.google.Chrome", "snap/firefox", ".config/chromium"]);
    const result = await installBridge(e, launch);

    expect(result.browsers.map((b) => b.browser)).toEqual(["chromium"]);
    expect(result.warnings).toEqual([
      { browser: "chrome", kind: "flatpak", message: expect.stringContaining("Flatpak") },
      { browser: "firefox", kind: "snap", message: expect.stringContaining("Snap") },
    ]);
    expect(logsOf(e).logs.some((l) => l.level === "WARN")).toBe(true);
  });

  it("reports a browser it could not set up as a warning and still sets up the others", async () => {
    const e = await env("linux", [".config/chromium", ".mozilla"]);
    await fs.writeFile(path.join(e.home, ".mozilla/native-messaging-hosts"), "a file where a folder belongs");
    const result = await installBridge(e, launch);

    expect(result.browsers.map((b) => b.browser)).toEqual(["chromium"]);
    expect(result.warnings).toEqual([{ browser: "firefox", kind: "failed", message: expect.any(String) }]);
    expect(logsOf(e).errors).toHaveLength(1);
  });
});

describe("installNativeHost on Windows", () => {
  it("writes manifests and a .cmd launcher, and points each browser's HKCU key at its manifest", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome", "HKCU\\Software\\Microsoft\\Edge", "HKCU\\Software\\Vivaldi", "HKCU\\Software\\Mozilla\\Firefox"]);
    const e = await env("win32", [], registry);
    const result = await installBridge(e, { ...launch, nodePath: "C:\\Code\\Code.exe", hostScript: "C:\\ext\\host 100%.js", electronRunAsNode: true });

    const bridgeDir = path.join(e.home, "AppData/Local/LabShelf/bridge");
    expect(result.launcher).toBe(path.join(bridgeDir, "labshelf-bridge.cmd"));
    expect(result.browsers.map((b) => b.browser)).toEqual(["chrome", "edge", "vivaldi", "firefox"]);
    expect(registry.values).toEqual(new Map([
      [`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${BRIDGE_HOST_NAME}`, path.join(bridgeDir, "chrome.json")],
      [`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${BRIDGE_HOST_NAME}`, path.join(bridgeDir, "edge.json")],
      [`HKCU\\Software\\Vivaldi\\NativeMessagingHosts\\${BRIDGE_HOST_NAME}`, path.join(bridgeDir, "vivaldi.json")],
      [`HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${BRIDGE_HOST_NAME}`, path.join(bridgeDir, "firefox.json")],
    ]));
    expect((await readJson(path.join(bridgeDir, "firefox.json")))["path"]).toBe(result.launcher);
    const script = await fs.readFile(result.launcher!, "utf8");
    expect(script).toContain("set ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain(`"C:\\Code\\Code.exe" "C:\\ext\\host 100%%.js" %*`);
  });

  it("puts the bridge folder under LOCALAPPDATA when it is set", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome"]);
    const localAppData = await makeTempDir();
    const e = { ...(await env("win32", [], registry)), localAppData };
    const result = await installBridge(e, launch);

    expect(result.launcher).toBe(path.join(localAppData, "LabShelf/bridge/labshelf-bridge.cmd"));
    expect(logsOf(e).logs.some((l) => l.level === "WARN")).toBe(false);
  });

  it("falls back to the home AppData\\Local folder without LOCALAPPDATA and logs the fallback", async () => {
    const e = await env("win32", [], fakeRegistry([]));
    const result = await installBridge(e, launch);

    expect(result.launcher).toBe(path.join(e.home, "AppData/Local/LabShelf/bridge/labshelf-bridge.cmd"));
    expect(logsOf(e).logs).toContainEqual(
      expect.objectContaining({ level: "WARN", message: expect.stringContaining("LOCALAPPDATA") }),
    );
  });

  it("fails clearly without a registry runner", async () => {
    const e = await env("win32");
    await expect(installBridge(e, launch)).rejects.toThrow(/registry/);
  });
});

