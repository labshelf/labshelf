/**
 * Pins where the bridge installer writes host manifests and the launcher, per browser and OS.
 * Locations: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
 * and https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BRIDGE_HOST_NAME } from "../../../../src/bridge/index";
import {
  bridgeStatus,
  installBridge,
  uninstallBridge,
  type BridgeEnv,
  type RegistryRunner,
} from "../../../../src/bridge/node/install/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir, pathExists } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const CHROME_ID = "ghcjlkjggiffdekaneoaoklhedjeeklh";
const launch = { nodePath: "/opt/node bin/node", hostScript: "/opt/labshelf/bridge-host.js", electronRunAsNode: false };

async function env(platform: NodeJS.Platform, dirs: string[] = [], registry?: RegistryRunner): Promise<BridgeEnv> {
  const home = await makeTempDir();
  await Promise.all(dirs.map((dir) => fs.mkdir(path.join(home, dir), { recursive: true })));
  return { home, platform, logger: fakeLogger(), ...(registry ? { registry } : {}) };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

/** In-memory `reg` that records every call. */
function fakeRegistry(existingKeys: string[]): RegistryRunner & { calls: string[][]; values: Map<string, string> } {
  const keys = new Set(existingKeys);
  const values = new Map<string, string>();
  const calls: string[][] = [];
  const run = async (args: readonly string[]) => {
    calls.push([...args]);
    const [verb, key] = args as [string, string];
    if (verb === "add") { values.set(key, args[args.indexOf("/d") + 1]!); return { exitCode: 0, stdout: "", stderr: "" }; }
    if (verb === "delete") { const had = values.delete(key); return { exitCode: had ? 0 : 1, stdout: "", stderr: "" }; }
    const value = values.get(key);
    if (value !== undefined) return { exitCode: 0, stdout: `\r\n${key}\r\n    (Default)    REG_SZ    ${value}\r\n`, stderr: "" };
    return { exitCode: keys.has(key) ? 0 : 1, stdout: "", stderr: "" };
  };
  return Object.assign(run, { calls, values });
}

describe("installBridge on macOS", () => {
  it("writes a Chrome manifest with allowed_origins and an executable sh launcher", async () => {
    const e = await env("darwin", ["Library/Application Support/Google/Chrome"]);
    const result = await installBridge(e, launch);

    const manifestPath = path.join(e.home, "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${BRIDGE_HOST_NAME}.json`);
    const launcher = path.join(e.home, ".config/labshelf/bridge/labshelf-bridge");
    expect(result).toEqual({ launcher, browsers: [{ browser: "chrome", label: "Google Chrome", manifestPath }], warnings: [] });
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
    const script = await fs.readFile(result.launcher, "utf8");
    expect(script).toContain(`ELECTRON_RUN_AS_NODE=1 exec '/Apps/Code'\\''s/Electron'`);
  });

  it("sets up no browser when none is installed", async () => {
    const e = await env("darwin");
    expect((await installBridge(e, launch)).browsers).toEqual([]);
  });
});

describe("installBridge on Linux", () => {
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

  it("warns about Flatpak and Snap browsers instead of failing", async () => {
    const e = await env("linux", [".var/app/com.google.Chrome", "snap/firefox", ".config/chromium"]);
    const result = await installBridge(e, launch);

    expect(result.browsers.map((b) => b.browser)).toEqual(["chromium"]);
    expect(result.warnings).toEqual([
      { browser: "chrome", kind: "flatpak", message: expect.stringContaining("Flatpak") },
      { browser: "firefox", kind: "snap", message: expect.stringContaining("Snap") },
    ]);
    expect((e.logger as ReturnType<typeof fakeLogger>).logs.some((l) => l.level === "WARN")).toBe(true);
  });

  it("reports a browser it could not set up as a warning and still sets up the others", async () => {
    const e = await env("linux", [".config/chromium", ".mozilla"]);
    await fs.writeFile(path.join(e.home, ".mozilla/native-messaging-hosts"), "a file where a folder belongs");
    const result = await installBridge(e, launch);

    expect(result.browsers.map((b) => b.browser)).toEqual(["chromium"]);
    expect(result.warnings).toEqual([{ browser: "firefox", kind: "failed", message: expect.any(String) }]);
    expect((e.logger as ReturnType<typeof fakeLogger>).errors).toHaveLength(1);
  });
});

describe("installBridge on Windows", () => {
  it("writes manifests and a .cmd launcher, and points each browser's HKCU key at its manifest", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome", "HKCU\\Software\\Mozilla\\Firefox"]);
    const e = await env("win32", [], registry);
    const result = await installBridge(e, { ...launch, nodePath: "C:\\Code\\Code.exe", hostScript: "C:\\ext\\host 100%.js", electronRunAsNode: true });

    const bridgeDir = path.join(e.home, "AppData/Local/LabShelf/bridge");
    expect(result.launcher).toBe(path.join(bridgeDir, "labshelf-bridge.cmd"));
    expect(result.browsers.map((b) => b.browser)).toEqual(["chrome", "firefox"]);
    expect(registry.values).toEqual(new Map([
      [`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${BRIDGE_HOST_NAME}`, path.join(bridgeDir, "chrome.json")],
      [`HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${BRIDGE_HOST_NAME}`, path.join(bridgeDir, "firefox.json")],
    ]));
    expect((await readJson(path.join(bridgeDir, "firefox.json")))["path"]).toBe(result.launcher);
    const script = await fs.readFile(result.launcher, "utf8");
    expect(script).toContain("set ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain(`"C:\\Code\\Code.exe" "C:\\ext\\host 100%%.js" %*`);
  });

  it("puts the bridge folder under LOCALAPPDATA when it is set", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome"]);
    const localAppData = await makeTempDir();
    const e = { ...(await env("win32", [], registry)), localAppData };
    const result = await installBridge(e, launch);

    expect(result.launcher).toBe(path.join(localAppData, "LabShelf/bridge/labshelf-bridge.cmd"));
    expect((e.logger as ReturnType<typeof fakeLogger>).logs.some((l) => l.level === "WARN")).toBe(false);
  });

  it("falls back to the home AppData\\Local folder without LOCALAPPDATA and logs the fallback", async () => {
    const e = await env("win32", [], fakeRegistry([]));
    const result = await installBridge(e, launch);

    expect(result.launcher).toBe(path.join(e.home, "AppData/Local/LabShelf/bridge/labshelf-bridge.cmd"));
    expect((e.logger as ReturnType<typeof fakeLogger>).logs).toContainEqual(
      expect.objectContaining({ level: "WARN", message: expect.stringContaining("LOCALAPPDATA") }),
    );
  });

  it("fails clearly without a registry runner", async () => {
    const e = await env("win32");
    await expect(installBridge(e, launch)).rejects.toThrow(/registry/);
  });
});

describe("bridgeStatus", () => {
  it("lists each detected browser as set up or not", async () => {
    const e = await env("linux", [".config/google-chrome", ".mozilla"]);
    expect(await bridgeStatus(e)).toMatchObject({ launcherPresent: false, browsers: [
      { browser: "chrome", installed: false }, { browser: "firefox", installed: false },
    ] });
    await installBridge(e, launch);
    expect(await bridgeStatus(e)).toMatchObject({ launcherPresent: true, warnings: [], browsers: [
      { browser: "chrome", installed: true }, { browser: "firefox", installed: true },
    ] });
  });

  it("treats a manifest whose launcher is gone as not set up", async () => {
    const e = await env("darwin", ["Library/Application Support/Google/Chrome"]);
    const { launcher } = await installBridge(e, launch);
    await fs.rm(launcher);
    expect((await bridgeStatus(e)).browsers).toMatchObject([{ browser: "chrome", installed: false }]);
  });

  it("checks the registry key on Windows", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome"]);
    const e = await env("win32", [], registry);
    await installBridge(e, launch);
    expect((await bridgeStatus(e)).browsers).toMatchObject([{ browser: "chrome", installed: true }]);
    registry.values.clear();
    expect((await bridgeStatus(e)).browsers).toMatchObject([{ browser: "chrome", installed: false }]);
  });
});

describe("uninstallBridge", () => {
  it("removes manifests and the launcher on Linux", async () => {
    const e = await env("linux", [".config/google-chrome", ".mozilla"]);
    const installed = await installBridge(e, launch);
    const result = await uninstallBridge(e);

    expect(result).toEqual({ removed: ["chrome", "firefox"], warnings: [] });
    for (const b of installed.browsers) expect(await pathExists(b.manifestPath)).toBe(false);
    expect(await pathExists(installed.launcher)).toBe(false);
    expect((await uninstallBridge(e)).removed).toEqual([]);
  });

  it("deletes the registry keys on Windows", async () => {
    const registry = fakeRegistry(["HKCU\\Software\\Google\\Chrome"]);
    const e = await env("win32", [], registry);
    await installBridge(e, launch);
    const result = await uninstallBridge(e);

    expect(result.removed).toEqual(["chrome"]);
    expect(registry.values.size).toBe(0);
    expect(await pathExists(path.join(e.home, "AppData/Local/LabShelf/bridge"))).toBe(false);
  });
});
