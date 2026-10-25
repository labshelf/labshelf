// Runs `labshelf bridge|helper install|status|uninstall`, which register the terminal app as a browser native-messaging host.
import * as path from "node:path";

import {
  BRIDGE_HOST_SPEC, HELPER_HOST_SPEC, installNativeHost, checkNativeHost, uninstallNativeHost,
  type NativeHostEnv, type NativeHostSpec, type NativeHostWarning, type ScriptLaunch,
} from "@labshelf/core/nativeHost/node";

import type { Output } from "../usage.js";

export type NativeHostCommand = "bridge" | "helper";

interface HostCommandInfo {
  spec: NativeHostSpec;
  /** What the command connects, for messages. */
  noun: string;
  /** The host script bundled next to labshelf.mjs. */
  hostFile: string;
}

const HOSTS: Record<NativeHostCommand, HostCommandInfo> = {
  bridge: { spec: BRIDGE_HOST_SPEC, noun: "the bridge", hostFile: "bridgeHost.js" },
  helper: { spec: HELPER_HOST_SPEC, noun: "the LaTeX helper", hostFile: "helperHost.mjs" },
};

export const NATIVE_HOST_COMMANDS = Object.keys(HOSTS) as NativeHostCommand[];

export function createNativeHostSpec(command: NativeHostCommand): NativeHostSpec {
  return HOSTS[command].spec;
}

/** @returns the launch that runs this app's bundled host script, found in `distDir` next to labshelf.mjs */
export function createTerminalLaunch(command: NativeHostCommand, distDir: string): ScriptLaunch {
  return { kind: "script", owner: "terminal", nodePath: process.execPath, hostScript: path.join(distDir, HOSTS[command].hostFile), electronRunAsNode: false };
}

function printWarnings(warnings: readonly NativeHostWarning[], io: Output): void {
  for (const warning of warnings) io.err(`warning: ${warning.message}`);
}

function successLine(command: NativeHostCommand, labels: string): string {
  return command === "helper"
    ? `LabShelf can now build LaTeX for ${labels}. Return to the browser; its LaTeX section notices the terminal app.`
    : "Restart the browser, then open the LabShelf extension and choose Connect.";
}

async function install(command: NativeHostCommand, replace: boolean, env: NativeHostEnv, launch: ScriptLaunch, io: Output): Promise<number> {
  const result = await installNativeHost(env, HOSTS[command].spec, launch, { replaceStandalone: replace });
  if (result.standalone) {
    io.out(`LabShelf Helper is installed at ${result.standalone} and builds LaTeX for the browser. Run \`labshelf helper install --replace\` to use this terminal app instead.`);
    return 0;
  }
  for (const browser of result.browsers) io.out(`${browser.label}  ${browser.manifestPath}`);
  printWarnings(result.warnings, io);
  if (result.browsers.length === 0) {
    io.err(`No supported browser was set up. Install Chrome, Chromium, Edge, Brave, Vivaldi or Firefox, then run \`labshelf ${command} install\` again.`);
    return 1;
  }
  io.out(successLine(command, result.browsers.map((browser) => browser.label).join(", ")));
  return result.warnings.some((warning) => warning.kind === "failed") ? 1 : 0;
}

async function status(command: NativeHostCommand, env: NativeHostEnv, io: Output): Promise<number> {
  const result = await checkNativeHost(env, HOSTS[command].spec);
  io.out(`launcher  ${result.launcher}`);
  for (const browser of result.browsers) {
    if (!browser.present) {
      io.out(`${browser.label}  not installed`);
    } else if (browser.manifest === "missing") {
      io.out(`${browser.label}  not connected`);
    } else {
      io.out(`${browser.label}  ${browser.manifest.kind === "launcher" ? "connected" : "connected to another host"}  ${browser.manifest.path}`);
    }
  }
  printWarnings(result.warnings, io);
  return 0;
}

async function uninstall(command: NativeHostCommand, env: NativeHostEnv, io: Output): Promise<number> {
  const { noun, spec } = HOSTS[command];
  const result = await uninstallNativeHost(env, spec);
  io.out(result.removed.length > 0 ? `Removed ${noun} from: ${result.removed.join(", ")}` : `${noun[0]!.toUpperCase()}${noun.slice(1)} was not installed in any browser.`);
  printWarnings(result.warnings, io);
  return result.warnings.length > 0 ? 1 : 0;
}

/** @returns the process exit code: 0 on success, 1 when a browser could not be set up, 2 for an unknown subcommand. */
export async function runNativeHostCommand(
  command: NativeHostCommand, subcommand: string | undefined, flags: { replace: boolean }, io: Output, env: NativeHostEnv, launch: ScriptLaunch,
): Promise<number> {
  if (subcommand === "install") return install(command, flags.replace, env, launch, io);
  if (subcommand === "status") return status(command, env, io);
  if (subcommand === "uninstall") return uninstall(command, env, io);
  io.err(subcommand ? `Unknown ${command} command: ${subcommand}` : `Missing ${command} command.`);
  io.err(`Usage: labshelf ${command} <install|status|uninstall>`);
  return 2;
}
