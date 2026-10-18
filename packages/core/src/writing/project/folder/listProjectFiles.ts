// Lists the files of a project folder, skipping hidden folders and node_modules.
import type { ProjectReadContext } from "./projectReadContext.js";

/** Paths of every file under the folder relative to it, "/"-separated and sorted; hidden folders and node_modules hold no project sources. */
export async function listProjectFiles({ fs, paths }: Pick<ProjectReadContext, "fs" | "paths">, folder: string): Promise<string[]> {
  // The port lists a missing folder as empty; a project folder that is gone must fail so callers log and skip it.
  if ((await fs.stat(folder))?.isDirectory !== true) { throw new Error(`${folder}: project folder not found`); }
  const files: string[] = [];
  const visit = async (dir: string, prefix: string): Promise<void> => {
    for (const name of await fs.listDir(dir)) {
      const full = paths.join(dir, name);
      const stat = await fs.stat(full);
      if (stat?.isDirectory && !name.startsWith(".") && name !== "node_modules") { await visit(full, `${prefix}${name}/`); }
      if (stat?.isFile) { files.push(`${prefix}${name}`); }
    }
  };
  await visit(folder, "");
  return files.sort();
}
