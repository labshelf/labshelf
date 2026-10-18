// Runs `labshelf bridge install|status|uninstall`, which connects the browser extension to the library folder.
import { bridgeStatus, installBridge, uninstallBridge, type BridgeEnv, type BridgeLaunch, type BridgeWarning } from "@labshelf/core/node";

import type { Output } from "./usage.js";

const BRIDGE_USAGE = "Usage: labshelf bridge <install|status|uninstall>";

function printWarnings(warnings: readonly BridgeWarning[], io: Output): void {
  for (const warning of warnings) io.err(`warning: ${warning.message}`);
}

async function install(env: BridgeEnv, launch: BridgeLaunch, io: Output): Promise<number> {
  const result = await installBridge(env, launch);
  for (const browser of result.browsers) io.out(`${browser.label}  ${browser.manifestPath}`);
  printWarnings(result.warnings, io);
  if (result.browsers.length === 0) {
    io.err("No supported browser was set up. Install Chrome, Chromium, Brave or Firefox, then run `labshelf bridge install` again.");
    return 1;
  }
  io.out("Restart the browser, then open the LabShelf extension and choose Connect.");
  return result.warnings.some((warning) => warning.kind === "failed") ? 1 : 0;
}

async function status(env: BridgeEnv, io: Output): Promise<number> {
  const result = await bridgeStatus(env);
  io.out(`launcher  ${result.launcher}  (${result.launcherPresent ? "present" : "missing"})`);
  for (const browser of result.browsers) io.out(`${browser.label}  ${browser.installed ? "connected" : "not connected"}  ${browser.manifestPath}`);
  printWarnings(result.warnings, io);
  return 0;
}

async function uninstall(env: BridgeEnv, io: Output): Promise<number> {
  const result = await uninstallBridge(env);
  io.out(result.removed.length > 0 ? `Removed the bridge from: ${result.removed.join(", ")}` : "The bridge was not installed in any browser.");
  printWarnings(result.warnings, io);
  return result.warnings.length > 0 ? 1 : 0;
}

/** @returns the process exit code: 0 on success, 1 when a browser could not be set up, 2 for an unknown subcommand. */
export async function runBridgeCommand(subcommand: string | undefined, io: Output, env: BridgeEnv, launch: BridgeLaunch): Promise<number> {
  if (subcommand === "install") return install(env, launch, io);
  if (subcommand === "status") return status(env, io);
  if (subcommand === "uninstall") return uninstall(env, io);
  io.err(subcommand ? `Unknown bridge command: ${subcommand}` : "Missing bridge command.");
  io.err(BRIDGE_USAGE);
  return 2;
}
