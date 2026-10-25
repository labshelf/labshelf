// Refuses to start the standalone helper when its binary or data folder can be changed by another user.
import { promises as fs } from "node:fs";

import { isGroupOrOtherWritable } from "../../../library/node/index.js";

/**
 * Throws, naming each path and its mode, when a path exists and is writable by its group or others; a path that does not exist yet passes.
 * The refusal is the error and is not logged: the helper logger would chmod the folder it refuses.
 * PLATFORM: Windows has no POSIX modes, so the check passes there.
 */
export async function assertPrivatePaths(paths: readonly string[], platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform === "win32") return;
  const loose: string[] = [];
  for (const target of paths) {
    const stat = await fs.stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat && isGroupOrOtherWritable(stat.mode)) loose.push(`${target} (mode ${(stat.mode & 0o777).toString(8)})`);
  }
  if (loose.length > 0) throw new Error(`labshelf helper will not start: ${loose.join(", ")} can be changed by other users; run chmod go-w on it`);
}
