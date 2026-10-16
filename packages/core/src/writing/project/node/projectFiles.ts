/** Lists the files of a project folder, skipping hidden folders and node_modules. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Absolute paths of every file under the folder; hidden folders and node_modules hold no project sources. */
export async function listProjectFiles(folder: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") { await visit(full); }
      if (entry.isFile()) { files.push(full); }
    }
  };
  await visit(folder);
  return files;
}
