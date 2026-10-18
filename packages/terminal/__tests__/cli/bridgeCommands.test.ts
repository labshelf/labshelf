// Tests for runBridgeCommand's argument handling and its install and status output.
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { BridgeEnv, BridgeLaunch } from "@labshelf/core/node";
import { runBridgeCommand, type Output } from "../../src/cli";
import { makeTempDir } from "../fixtures/library";

function capture(): { io: Output; text: () => string } {
  const lines: string[] = [];
  return { io: { out: (t) => lines.push(t), err: (t) => lines.push(t), columns: 100 }, text: () => lines.join("\n") };
}

const logger = { log: async () => undefined, error: async () => undefined };
const launch: BridgeLaunch = { nodePath: "/usr/bin/node", hostScript: "/opt/labshelf/bridgeHost.js", electronRunAsNode: false };

async function linuxEnvWithChrome(): Promise<BridgeEnv> {
  const home = await makeTempDir();
  await fs.mkdir(path.join(home, ".config", "google-chrome"), { recursive: true });
  return { home, platform: "linux", logger: logger as unknown as BridgeEnv["logger"] };
}

describe("runBridgeCommand", () => {
  it("prints the usage and fails for an unknown subcommand", async () => {
    const { io, text } = capture();
    expect(await runBridgeCommand("frobnicate", io, await linuxEnvWithChrome(), launch)).toBe(2);
    expect(text()).toContain("Unknown bridge command: frobnicate");
    expect(text()).toContain("Usage: labshelf bridge <install|status|uninstall>");
  });

  it("prints the usage and fails when the subcommand is missing", async () => {
    const { io, text } = capture();
    expect(await runBridgeCommand(undefined, io, await linuxEnvWithChrome(), launch)).toBe(2);
    expect(text()).toContain("Missing bridge command.");
  });

  it("installs for a present browser, reports its manifest, and status then shows it connected", async () => {
    const env = await linuxEnvWithChrome();
    const installed = capture();
    expect(await runBridgeCommand("install", installed.io, env, launch)).toBe(0);
    const manifest = path.join(env.home, ".config", "google-chrome", "NativeMessagingHosts", "app.labshelf.bridge.json");
    expect(installed.text()).toContain(manifest);
    const status = capture();
    expect(await runBridgeCommand("status", status.io, env, launch)).toBe(0);
    expect(status.text()).toMatch(/Google Chrome\s+connected/);
  });

  it("fails when no supported browser is present", async () => {
    const env = { ...(await linuxEnvWithChrome()), home: await makeTempDir() };
    const { io, text } = capture();
    expect(await runBridgeCommand("install", io, env, launch)).toBe(1);
    expect(text()).toContain("No supported browser was set up");
  });
});
