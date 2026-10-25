// Finds when a project's source files were last edited.
import { listProjectFiles } from "./listProjectFiles.js";
import type { ProjectReadContext } from "./projectReadContext.js";

const SOURCE_EXTENSIONS = new Set([".tex", ".typ", ".bib", ".sty", ".cls", ".yaml"]);

/** @returns the newest mtime in ms among the source files, or undefined when there are none */
export async function readLastModified(context: Pick<ProjectReadContext, "fs" | "paths">, folder: string): Promise<number | undefined> {
  const { fs, paths } = context;
  const sources = (await listProjectFiles(context, folder)).filter((file) => SOURCE_EXTENSIONS.has(paths.extname(file).toLowerCase()));
  const times = await Promise.all(sources.map(async (file) => (await fs.stat(paths.join(folder, file)))?.mtimeMs ?? 0));
  return times.length === 0 ? undefined : Math.max(...times);
}
