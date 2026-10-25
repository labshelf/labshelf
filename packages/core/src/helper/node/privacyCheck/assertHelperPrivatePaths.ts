// Refuses to start the standalone helper when its binary, its folder or its data folder can be changed by another user.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { assertPrivatePaths } from "./assertPrivatePaths.js";

export interface HelperPrivatePaths { binaryPath: string; dataDir: string }

// A root-owned folder such as /usr/local/bin may be group-writable by design; only root could tighten it.
async function isRootOwned(folder: string): Promise<boolean> {
  const stat = await fs.stat(folder).catch(() => undefined);
  return stat?.uid === 0;
}

export async function assertHelperPrivatePaths({ binaryPath, dataDir }: HelperPrivatePaths, platform: NodeJS.Platform = process.platform): Promise<void> {
  const binaryDir = path.dirname(binaryPath);
  const paths = [binaryPath, dataDir, path.join(dataDir, "bin")];
  if (!(await isRootOwned(binaryDir))) { paths.push(binaryDir); }
  await assertPrivatePaths(paths, platform);
}
