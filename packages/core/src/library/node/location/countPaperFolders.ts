// Counts the paper folders under a directory.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { METADATA_FILE } from "../../layout.js";

// A folder with a metadata file is a paper and is not descended into; any other folder is a collection.
// Dirent reports a symlink as neither file nor folder, so links are never followed or counted; a missing folder counts 0.
export async function countPaperFolders(dir: string): Promise<number> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") { return []; }
    throw error;
  });
  if (entries.some((entry) => entry.isFile() && entry.name === METADATA_FILE)) { return 1; }
  const counts = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => countPaperFolders(path.join(dir, entry.name))));
  return counts.reduce((sum, count) => sum + count, 0);
}
