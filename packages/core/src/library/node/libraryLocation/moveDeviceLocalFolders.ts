// Moves a library's cache and state folders to the folders named by its new root, so the AI index and logs follow it.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { cacheDir } from "../cacheDir.js";
import { stateDir } from "../deviceState/index.js";

/** A folder that cannot move stays where it is and is logged; the library move has already succeeded. */
export async function moveDeviceLocalFolders(
  fromKey: string,
  toKey: string,
  env: NodeJS.ProcessEnv,
  logger: ILogger,
): Promise<void> {
  if (fromKey === toKey) { return; }
  for (const base of [cacheDir(env), stateDir(env)]) {
    const source = path.join(base, "libraries", fromKey);
    const target = path.join(base, "libraries", toKey);
    if (!(await fs.stat(source).then((stat) => stat.isDirectory(), () => false))) { continue; }
    try {
      await fs.rename(source, target);
    } catch (error) {
      await logger.error("libraryMove", error, { action: "move device-local folder", from: source, to: target });
    }
  }
}
