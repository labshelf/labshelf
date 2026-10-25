// Gives the helper binary a second program name, labshelf-bridge, that browsers start for the bridge host.
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const BRIDGE_PROGRAM_NAME = "labshelf-bridge";
/** The first argument that makes the binary serve the bridge host, for a name the binary cannot be started under. */
export const BRIDGE_HOST_FLAG = "--host=bridge";

const pathApi = (platform: NodeJS.Platform): path.PlatformPath => (platform === "win32" ? path.win32 : path.posix);

/** The program the bridge manifest points at, next to the helper binary. */
export function createBridgeAliasPath(binaryPath: string, platform: NodeJS.Platform): string {
  const api = pathApi(platform);
  return api.join(api.dirname(binaryPath), platform === "win32" ? `${BRIDGE_PROGRAM_NAME}.cmd` : BRIDGE_PROGRAM_NAME);
}

// PLATFORM: Windows has no symlinks without privileges, and a .cmd starts the exe under the exe's own name, so the shim names the host in an argument.
export function createBridgeShim(helperExecutableName: string): string {
  return `@echo off\r\n"%~dp0${helperExecutableName}" ${BRIDGE_HOST_FLAG} %*\r\n`;
}

export async function createBridgeAlias(binaryPath: string, platform: NodeJS.Platform): Promise<string> {
  const alias = createBridgeAliasPath(binaryPath, platform);
  await fs.rm(alias, { force: true });
  const binaryName = pathApi(platform).basename(binaryPath);
  // A relative target keeps the link valid when the folder is moved.
  if (platform === "win32") await fs.writeFile(alias, createBridgeShim(binaryName));
  else await fs.symlink(binaryName, alias);
  return alias;
}

export async function removeBridgeAlias(binaryPath: string, platform: NodeJS.Platform): Promise<void> {
  await fs.rm(createBridgeAliasPath(binaryPath, platform), { force: true });
}
