/** Finds when a project's source files were last edited. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { listProjectFiles } from "./projectFiles.js";

const SOURCE_EXTENSIONS = new Set([".tex", ".typ", ".bib", ".sty", ".cls", ".yaml"]);

/** @returns the newest mtime in ms among the source files, or undefined when there are none */
export async function lastModified(folder: string): Promise<number | undefined> {
  const sources = (await listProjectFiles(folder)).filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const times = await Promise.all(sources.map(async (file) => (await fs.stat(file)).mtimeMs));
  return times.length === 0 ? undefined : Math.max(...times);
}
