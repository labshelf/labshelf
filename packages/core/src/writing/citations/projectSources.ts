/** Reads the source files of a project: every file of its format under the folder, with the text an open editor holds or the disk. */
import { listProjectFiles, type OpenSources, type ProjectFormat, type ProjectReadContext } from "../project/index.js";

// --- Project sources ---

/** Sources read from the disk only, with no open editor whose unsaved text takes precedence. */
export const DISK_ONLY: OpenSources = { text: () => undefined, replace: async () => false };

const SOURCE_EXTENSION: Record<ProjectFormat, string> = { latex: ".tex", typst: ".typ" };

export interface ProjectSource {
  /** The path as the file system port addresses it. */
  file: string;
  /** Relative to the project folder, "/"-separated. */
  relative: string;
  text: string;
}

/** Every source file of the format under the folder, with its text (an open editor's unsaved text wins over the disk); hidden folders and node_modules are not sources. */
export async function* walkProjectSources(
  context: Pick<ProjectReadContext, "fs" | "paths">, folder: string, format: ProjectFormat, open: OpenSources = DISK_ONLY,
): AsyncGenerator<ProjectSource> {
  for (const relative of await listProjectFiles(context, folder)) {
    if (!relative.endsWith(SOURCE_EXTENSION[format])) { continue; }
    const file = context.paths.join(folder, relative);
    yield { file, relative, text: open.text(file) ?? await context.fs.readText(file) };
  }
}
