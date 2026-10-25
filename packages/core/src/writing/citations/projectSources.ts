// Reads a project's LaTeX or Typst sources, taking an open editor's unsaved text over the disk.
import type { OpenSources, ProjectFormat } from "../project/index.js";
import { listProjectFiles, type ProjectReadContext } from "../project/folder/index.js";

export const DISK_ONLY: OpenSources = { text: () => undefined, replace: async () => false };

const SOURCE_EXTENSION: Record<ProjectFormat, string> = { latex: ".tex", typst: ".typ" };

export interface ProjectSource {
  /** The path as the file system port addresses it. */
  file: string;
  /** Relative to the project folder, "/"-separated. */
  relative: string;
  text: string;
}

/** Every source file of the format under the folder, with its text; hidden folders and node_modules are not sources. */
export async function* projectSources(
  context: Pick<ProjectReadContext, "fs" | "paths">, folder: string, format: ProjectFormat, open: OpenSources = DISK_ONLY,
): AsyncGenerator<ProjectSource> {
  for (const relative of await listProjectFiles(context, folder)) {
    if (!relative.endsWith(SOURCE_EXTENSION[format])) { continue; }
    const file = context.paths.join(folder, relative);
    yield { file, relative, text: open.text(file) ?? await context.fs.readText(file) };
  }
}
