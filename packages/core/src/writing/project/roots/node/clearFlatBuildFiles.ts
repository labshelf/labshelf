/** Removes a root's stray build files from the top of the project build folder. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../../ports/index.js";

const MODULE = "writing.project.clearFlatBuildFiles";

// Flat layouts wrote `<base>.aux`, `<base>.pdf` and friends straight into the project build dir; stale copies would shadow the per-root folder's output.
export async function clearFlatBuildFiles(projectBuildDir: string, root: string, logger: ILogger): Promise<void> {
  const base = path.posix.basename(root, path.posix.extname(root));
  let entries;
  try {
    entries = await fs.readdir(projectBuildDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    await logger.error(MODULE, error, { projectBuildDir, root, step: "list" });
    return;
  }
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(`${base}.`)) continue;
    try {
      await fs.rm(path.join(projectBuildDir, entry.name), { force: true });
      removed.push(entry.name);
    } catch (error) {
      await logger.error(MODULE, error, { projectBuildDir, root, file: entry.name, step: "remove" });
    }
  }
  if (removed.length > 0) await logger.log("INFO", MODULE, "Removed flat build files", { projectBuildDir, root, removed });
}
