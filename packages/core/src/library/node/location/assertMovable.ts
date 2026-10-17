// Refuses library moves that could lose data, before anything is touched.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { isLibraryFolder } from "./inspectLibraryFolder.js";

// The target may not exist yet, so resolve its nearest existing ancestor and append the rest.
async function realPathOfFuture(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
    const parent = path.dirname(target);
    if (parent === target) { return target; }
    return path.join(await realPathOfFuture(parent), path.basename(target));
  }
}

async function holdsFiles(dir: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || (await holdsFiles(path.join(dir, entry.name)))) { return true; }
  }
  return false;
}

/**
 * @throws when the source is not a library, the target is the source or inside it, or the target holds any file
 * (an existing folder with only empty folders is allowed)
 */
export async function assertMovable(from: string, to: string): Promise<void> {
  if (!(await isLibraryFolder(from))) { throw new Error(`${from} is not a library`); }
  const relative = path.relative(await fs.realpath(from), await realPathOfFuture(to));
  if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error(`The target ${to} is the library folder or inside it`);
  }
  const stat = await fs.stat(to).catch(() => undefined);
  if (stat && (!stat.isDirectory() || (await holdsFiles(to)))) {
    throw new Error(`The target ${to} is not empty`);
  }
}
