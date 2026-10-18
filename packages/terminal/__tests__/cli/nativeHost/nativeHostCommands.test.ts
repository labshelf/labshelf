// Tests for runNativeHostCommand: argument handling and the install, status and uninstall output of the bridge and helper commands.
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { BRIDGE_HOST_SPEC, HELPER_HOST_SPEC, type NativeHostEnv } from "@labshelf/core/nativeHost/node";
import { runNativeHostCommand, terminalLaunch, type NativeHostCommand } from "../../../src/cli/nativeHost/nativeHostCommands";
import type { Output } from "../../../src/cli";
import { makeTempDir } from "../../fixtures/library";

function capture(): { io: Output; text: () => string } {
  const lines: string[] = [];
  return { io: { out: (t) => lines.push(t), err: (t) => lines.push(t), columns: 100 }, text: () => lines.join("\n") };
}

const logger = { log: async () => undefined, error: async () => undefined };
const NO_FLAGS = { replace: false };

async function linuxEnvWithChrome(): Promise<NativeHostEnv> {
  const home = await makeTempDir();
  await fs.mkdir(path.join(home, ".config", "google-chrome"), { recursive: true });
  return { home, platform: "linux", logger: logger as unknown as NativeHostEnv["logger"] };
}

const chromeManifest = (env: NativeHostEnv, host: string): string => path.join(env.home, ".config", "google-chrome", "NativeMessagingHosts", `${host}.json`);
const nativeHostSpec = (command: NativeHostCommand) => (command === "bridge" ? BRIDGE_HOST_SPEC : HELPER_HOST_SPEC);
const launch = (command: NativeHostCommand) => terminalLaunch(command, "/opt/labshelf");

describe("terminalLaunch", () => {
  it("points at the host script bundled next to labshelf.mjs", () => {
    expect(terminalLaunch("bridge", "/opt/labshelf")).toMatchObject({ owner: "terminal", hostScript: path.join("/opt/labshelf", "bridgeHost.js"), electronRunAsNode: false });
    expect(terminalLaunch("helper", "/opt/labshelf").hostScript).toBe(path.join("/opt/labshelf", "helperHost.mjs"));
  });
});

describe.each(["bridge", "helper"] as const)("runNativeHostCommand %s", (command) => {
  it("prints the usage and fails for an unknown subcommand", async () => {
    const { io, text } = capture();
    expect(await runNativeHostCommand(command, "frobnicate", NO_FLAGS, io, await linuxEnvWithChrome(), launch(command))).toBe(2);
    expect(text()).toContain(`Unknown ${command} command: frobnicate`);
    expect(text()).toContain(`Usage: labshelf ${command} <install|status|uninstall>`);
  });

  it("prints the usage and fails when the subcommand is missing", async () => {
    const { io, text } = capture();
    expect(await runNativeHostCommand(command, undefined, NO_FLAGS, io, await linuxEnvWithChrome(), launch(command))).toBe(2);
    expect(text()).toContain(`Missing ${command} command.`);
  });

  it("installs for a present browser, then status shows it connected and uninstall removes it", async () => {
    const env = await linuxEnvWithChrome();
    const installed = capture();
    expect(await runNativeHostCommand(command, "install", NO_FLAGS, installed.io, env, launch(command))).toBe(0);
    const manifestPath = chromeManifest(env, nativeHostSpec(command).hostName);
    expect(installed.text()).toContain(manifestPath);
    const status = capture();
    expect(await runNativeHostCommand(command, "status", NO_FLAGS, status.io, env, launch(command))).toBe(0);
    expect(status.text()).toMatch(/Google Chrome\s+connected/);
    const removed = capture();
    expect(await runNativeHostCommand(command, "uninstall", NO_FLAGS, removed.io, env, launch(command))).toBe(0);
    expect(removed.text()).toContain("chrome");
    await expect(fs.access(manifestPath)).rejects.toThrow();
  });

  it("fails when no supported browser is present", async () => {
    const env = { ...(await linuxEnvWithChrome()), home: await makeTempDir() };
    const { io, text } = capture();
    expect(await runNativeHostCommand(command, "install", NO_FLAGS, io, env, launch(command))).toBe(1);
    expect(text()).toContain("No supported browser was set up");
    expect(text()).toContain(`labshelf ${command} install`);
  });
});

describe("helper install messages", () => {
  it("names the browsers the helper now builds LaTeX for", async () => {
    const { io, text } = capture();
    expect(await runNativeHostCommand("helper", "install", NO_FLAGS, io, await linuxEnvWithChrome(), launch("helper"))).toBe(0);
    expect(text()).toContain("LabShelf can now build LaTeX for Google Chrome. Return to the browser; its LaTeX section notices the terminal app.");
  });

  it("leaves a standalone LabShelf Helper alone, and --replace takes over", async () => {
    const env = await linuxEnvWithChrome();
    const manifest = chromeManifest(env, HELPER_HOST_SPEC.hostName);
    await fs.mkdir(path.join(env.home, "opt"), { recursive: true });
    const standalone = path.join(env.home, "opt", "labshelf-helper");
    await fs.writeFile(standalone, "");
    await fs.mkdir(path.dirname(manifest), { recursive: true });
    await fs.writeFile(manifest, JSON.stringify({ name: HELPER_HOST_SPEC.hostName, path: standalone, type: "stdio" }));
    const kept = capture();
    expect(await runNativeHostCommand("helper", "install", NO_FLAGS, kept.io, env, launch("helper"))).toBe(0);
    expect(kept.text()).toContain(`LabShelf Helper is installed at ${standalone} and builds LaTeX for the browser. Run \`labshelf helper install --replace\` to use this terminal app instead.`);
    expect(JSON.parse(await fs.readFile(manifest, "utf8")).path).toBe(standalone);

    const replaced = capture();
    expect(await runNativeHostCommand("helper", "install", { replace: true }, replaced.io, env, launch("helper"))).toBe(0);
    expect(JSON.parse(await fs.readFile(manifest, "utf8")).path).not.toBe(standalone);
  });
});
