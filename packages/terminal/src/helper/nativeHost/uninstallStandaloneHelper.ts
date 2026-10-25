// Removes the standalone helper from the user's machine: both host registrations, the bridge name and the helper's bin/ folder.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { NativeHostEnv } from "@labshelf/core/nativeHost/node";

import { uninstallStandaloneHosts } from "./standaloneHosts.js";

/**
 * Returns the unregister exit code. The data folder's projects and logs and the shared managed tools folder stay: they are the user's.
 * PLATFORM: the running binary can be deleted on POSIX; Windows installs live outside bin/ and are removed by the installer.
 */
export async function uninstallStandaloneHelper(env: NativeHostEnv, binaryPath: string, dataDir: string): Promise<number> {
  const code = await uninstallStandaloneHosts(env, binaryPath);
  await fs.rm(path.join(dataDir, "bin"), { recursive: true, force: true });
  return code;
}
